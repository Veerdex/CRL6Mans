"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { getStaffRole, hasMfaEnabled, type StaffRole } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { canActOn, kickAccount, banAccount, NO_PERMISSION, type RevokedPatron } from "@/app/lib/moderation";
import { removeRole, timeoutMember, unbanMember } from "@/app/lib/discord-api";
import { recordStaffAction } from "@/app/lib/staff-contributions";

async function getActorRole(): Promise<StaffRole> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/dashboard");
  const role = await getStaffRole(session.userId);
  if (!role) redirect("/dashboard");
  if (!(await hasMfaEnabled(session.userId))) redirect("/dashboard");
  return role;
}

async function applyKick(
  accountId: string,
  reason: string,
  timeoutMs: number = 7 * 24 * 60 * 60 * 1000,
  kickedUntil: Date | null = null
): Promise<{ ok?: boolean; error?: string }> {
  const result = await kickAccount(await getActorRole(), accountId, reason, timeoutMs, kickedUntil);
  if (result.error) return result;

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return result;
}

export async function kickPlayer(
  accountId: string,
  reason: string,
  timeoutMs: number = 7 * 24 * 60 * 60 * 1000,
  kickedUntil: Date | null = null
): Promise<{ ok?: boolean; error?: string }> {
  const result = await applyKick(accountId, reason, timeoutMs, kickedUntil);
  if (!result.error) await recordStaffAction("player_kicked", accountId);
  return result;
}

export type RejectionCooldown = "5m" | "1d" | "forever";

// Reused by rejectPlatformAccount for the optional cooldown on a rejected
// platform-account claim. "forever" reuses kickPlayer's default (permanent
// kick_reason, no kicked_until, standard Discord timeout) — same broad kick
// as the moderation panel. "5m"/"1d" set kicked_until to match, and size the
// Discord timeout to the same window so the two don't disagree.
//
// Goes through applyKick rather than kickPlayer so it scores no contribution of
// its own — the rejection that triggered it already scored one, and this is the
// same decision, not a second one.
export async function kickForRejectionCooldown(
  accountId: string,
  reason: string,
  cooldown: RejectionCooldown
): Promise<{ ok?: boolean; error?: string }> {
  if (cooldown === "forever") return applyKick(accountId, reason);
  const ms = cooldown === "5m" ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return applyKick(accountId, reason, ms, new Date(Date.now() + ms));
}

export async function banPlayer(
  accountId: string,
  reason: string
): Promise<{ ok?: boolean; error?: string; revokedPatron?: RevokedPatron }> {
  const result = await banAccount(await getActorRole(), accountId, reason);
  if (result.error) return result;

  await recordStaffAction("player_banned", accountId);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  revalidatePath("/dashboard/support");
  return result;
}

export async function unkickPlayer(
  accountId: string
): Promise<{ ok?: boolean; error?: string }> {
  const actorRole = await getActorRole();

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, kick_reason, kicked_until")
    .eq("id", accountId)
    .single();

  const targetRole = account?.discord_id ? await getStaffRole(account.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: NO_PERMISSION };

  const wasKicked = !!(account?.kick_reason || account?.kicked_until);

  const { error } = await supabaseAdmin
    .from("accounts")
    .update({
      kick_reason: null,
      kicked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return { error: error.message };

  if (account?.discord_id && !account.discord_id.startsWith("test_")) {
    await removeRole(account.discord_id, "Kicked");
    await timeoutMember(account.discord_id, 0);
  }

  // Clearing a kick that was never there is a no-op, not a contribution.
  if (wasKicked) await recordStaffAction("player_unkicked", accountId);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}

export async function unbanPlayer(
  accountId: string
): Promise<{ ok?: boolean; error?: string }> {
  const actorRole = await getActorRole();

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, status")
    .eq("id", accountId)
    .single();

  const targetRole = account?.discord_id ? await getStaffRole(account.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: NO_PERMISSION };

  const wasBanned = account?.status === "banned";

  // They must re-register from scratch when they rejoin: delete the Tier 3
  // (players) and Tier 2 (pending_players) rows for this account. Historical
  // records (tournament entries, sub requests, edit requests, platform-account
  // verification) survive as orphaned rows rather than cascade-deleting — see
  // the FK-retargeting section of scripts/tiered-accounts-migration.sql.
  await supabaseAdmin.from("players").delete().eq("account_id", accountId);
  await supabaseAdmin.from("pending_players").delete().eq("account_id", accountId);

  const { error } = await supabaseAdmin
    .from("accounts")
    .update({
      status: "unregistered",
      ban_reason: null,
      kick_reason: null,
      kicked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return { error: error.message };

  if (account?.discord_id && !account.discord_id.startsWith("test_")) {
    await unbanMember(account.discord_id); // lift Discord server ban so they can rejoin
  }

  if (wasBanned) await recordStaffAction("player_unbanned", accountId);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}
