"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { adjustCoinsByAccount, setCoinsByAccount, type CoinAdjustment } from "@/app/lib/coins";

async function requireDirector(): Promise<string> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
  return session.userId;
}

// The clamp at 0 now lives in adjust_crl_coins (see
// scripts/coin-ledger-migration.sql) along with the write itself. Westside Wages
// has no concept of debt anywhere else in the codebase (bet placement checks
// crl_coins >= cost), so letting an admin adjustment push a balance negative
// would put the player in a state normal gameplay can never produce or recover
// from. Doing it in the DB is what stops the adjustment from overwriting a bet
// that settled between the read and the write.

export async function adjustPlayerBalance(
  playerId: string,
  amount: number,
  reason: string,
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireDirector();
  if (!Number.isInteger(amount) || amount === 0) return { error: "Enter a non-zero whole number." };
  if (!reason.trim()) return { error: "A reason is required." };

  // crl_coins lives on accounts (Tier 1) now. playerId here is still an
  // approved player's players.id, which is always equal to accounts.id
  // (players.id = accounts.id by construction — see approvePlayerWithEdits),
  // so wager_balance_adjustments.player_id (an FK into players(id)) keeps
  // resolving correctly with no change to that table.
  const adjusted = await adjustCoinsByAccount(playerId, amount, `admin adjustment: ${reason.trim()}`);
  if (!adjusted) return { error: "Player not found." };

  await supabaseAdmin.from("wager_balance_adjustments").insert({
    scope: "single",
    player_id: playerId,
    requested_amount: amount,
    amount: adjusted.applied,
    balance_after: adjusted.balanceAfter,
    reason: reason.trim(),
    actor: adminId,
  });

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// League-wide economic mutation touching every approved player at once —
// Director+ only, same bar as the other serious league-wide toggles
// (setJoinGateEnabled, setReplayAnalysisMode).
export async function bulkAdjustAllBalances(
  amount: number,
  reason: string,
): Promise<{ error?: string; ok?: boolean; affected?: number }> {
  const adminId = await requireDirector();
  if (!Number.isInteger(amount) || amount === 0) return { error: "Enter a non-zero whole number." };
  if (!reason.trim()) return { error: "A reason is required." };

  const { data: accounts } = await supabaseAdmin
    .from("accounts")
    .select("id")
    .eq("status", "approved");
  if (!accounts?.length) return { error: "No approved players found." };

  const batchId = crypto.randomUUID();
  const results = await Promise.all(
    accounts.map(async a => ({
      id: a.id as string,
      adjusted: await adjustCoinsByAccount(a.id, amount, `bulk adjustment: ${reason.trim()}`),
    })),
  );
  const applied = results.filter((r): r is { id: string; adjusted: CoinAdjustment } => r.adjusted !== null);

  await supabaseAdmin.from("wager_balance_adjustments").insert(
    applied.map(r => ({
      batch_id: batchId,
      scope: "bulk" as const,
      player_id: r.id,
      requested_amount: amount,
      amount: r.adjusted.applied,
      balance_after: r.adjusted.balanceAfter,
      reason: reason.trim(),
      actor: adminId,
    })),
  );

  revalidatePath("/dashboard/admin");
  return { ok: true, affected: applied.length };
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
    .select("id")
    .eq("status", "approved");
  if (!accounts?.length) return { error: "No approved players found." };

  const batchId = crypto.randomUUID();
  const results = await Promise.all(
    accounts.map(async a => ({
      id: a.id as string,
      adjusted: await setCoinsByAccount(a.id, STARTING_BALANCE, `balance reset: ${reason.trim()}`),
    })),
  );
  const applied = results.filter((r): r is { id: string; adjusted: CoinAdjustment } => r.adjusted !== null);

  await supabaseAdmin.from("wager_balance_adjustments").insert(
    applied.map(r => ({
      batch_id: batchId,
      scope: "bulk" as const,
      player_id: r.id,
      requested_amount: STARTING_BALANCE,
      amount: r.adjusted.applied,
      balance_after: r.adjusted.balanceAfter,
      reason: reason.trim(),
      actor: adminId,
    })),
  );

  revalidatePath("/dashboard/admin");
  return { ok: true, affected: applied.length };
}
