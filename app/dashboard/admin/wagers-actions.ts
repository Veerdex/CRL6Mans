"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified, isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

async function requireModerator(): Promise<string> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
  return session.userId;
}

async function requireDirector(): Promise<string> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
  return session.userId;
}

// Clamped at 0 — Westside Wages has no concept of debt anywhere else in the
// codebase (bet placement checks crl_coins >= cost), so letting an admin
// adjustment push a balance negative would put the player in a state normal
// gameplay can never produce or recover from.
function applyClamped(current: number, amount: number): number {
  return Math.max(0, current + amount);
}

export async function adjustPlayerBalance(
  playerId: string,
  amount: number,
  reason: string,
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireModerator();
  if (!Number.isInteger(amount) || amount === 0) return { error: "Enter a non-zero whole number." };
  if (!reason.trim()) return { error: "A reason is required." };

  // crl_coins lives on accounts (Tier 1) now. playerId here is still an
  // approved player's players.id, which is always equal to accounts.id
  // (players.id = accounts.id by construction — see approvePlayerWithEdits),
  // so wager_balance_adjustments.player_id (an FK into players(id)) keeps
  // resolving correctly with no change to that table.
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("id, crl_coins")
    .eq("id", playerId)
    .single();
  if (!account) return { error: "Player not found." };

  const current = account.crl_coins ?? 0;
  const balanceAfter = applyClamped(current, amount);

  const { error } = await supabaseAdmin
    .from("accounts")
    .update({ crl_coins: balanceAfter })
    .eq("id", playerId);
  if (error) return { error: "Failed to update balance." };

  await supabaseAdmin.from("wager_balance_adjustments").insert({
    scope: "single",
    player_id: playerId,
    requested_amount: amount,
    amount: balanceAfter - current,
    balance_after: balanceAfter,
    reason: reason.trim(),
    actor: adminId,
  });

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// League-wide economic mutation touching every approved player at once —
// Director+ only, same bar as the other serious league-wide toggles
// (setIdentityEnforcementEnabled, setJoinGateEnabled).
export async function bulkAdjustAllBalances(
  amount: number,
  reason: string,
): Promise<{ error?: string; ok?: boolean; affected?: number }> {
  const adminId = await requireDirector();
  if (!Number.isInteger(amount) || amount === 0) return { error: "Enter a non-zero whole number." };
  if (!reason.trim()) return { error: "A reason is required." };

  const { data: accounts } = await supabaseAdmin
    .from("accounts")
    .select("id, crl_coins")
    .eq("status", "approved");
  if (!accounts?.length) return { error: "No approved players found." };

  const batchId = crypto.randomUUID();
  const updates = accounts.map(a => {
    const current = a.crl_coins ?? 0;
    const balanceAfter = applyClamped(current, amount);
    return { id: a.id, balanceAfter, applied: balanceAfter - current };
  });

  await Promise.all(
    updates.map(u => supabaseAdmin.from("accounts").update({ crl_coins: u.balanceAfter }).eq("id", u.id)),
  );

  await supabaseAdmin.from("wager_balance_adjustments").insert(
    updates.map(u => ({
      batch_id: batchId,
      scope: "bulk" as const,
      player_id: u.id,
      requested_amount: amount,
      amount: u.applied,
      balance_after: u.balanceAfter,
      reason: reason.trim(),
      actor: adminId,
    })),
  );

  revalidatePath("/dashboard/admin");
  return { ok: true, affected: updates.length };
}

const STARTING_BALANCE = 1000;

// Sets every approved player's balance to the standard starting amount,
// wiping out whatever they'd accumulated (grants, wins, losses, prior manual
// adjustments) — for starting a season on an even footing rather than
// carrying balances forward. Distinct from bulkAdjustAllBalances, which
// applies a signed delta on top of each player's current balance instead of
// overwriting it. Director+ only, same bar as bulkAdjustAllBalances.
export async function resetAllBalancesToStart(
  reason: string,
): Promise<{ error?: string; ok?: boolean; affected?: number }> {
  const adminId = await requireDirector();
  if (!reason.trim()) return { error: "A reason is required." };

  const { data: accounts } = await supabaseAdmin
    .from("accounts")
    .select("id, crl_coins")
    .eq("status", "approved");
  if (!accounts?.length) return { error: "No approved players found." };

  const batchId = crypto.randomUUID();
  const updates = accounts.map(a => ({ id: a.id, applied: STARTING_BALANCE - (a.crl_coins ?? 0) }));

  await Promise.all(
    updates.map(u => supabaseAdmin.from("accounts").update({ crl_coins: STARTING_BALANCE }).eq("id", u.id)),
  );

  await supabaseAdmin.from("wager_balance_adjustments").insert(
    updates.map(u => ({
      batch_id: batchId,
      scope: "bulk" as const,
      player_id: u.id,
      requested_amount: STARTING_BALANCE,
      amount: u.applied,
      balance_after: STARTING_BALANCE,
      reason: reason.trim(),
      actor: adminId,
    })),
  );

  revalidatePath("/dashboard/admin");
  return { ok: true, affected: updates.length };
}
