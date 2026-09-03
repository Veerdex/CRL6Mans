"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt, invalidatePlayerSessions } from "@/app/lib/session";
import { getStaffRole, hasMfaEnabled, removeRegisteredRole, type StaffRole } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { revokedPatronFields } from "@/app/lib/patreon-sync";
import { addRole, removeRole, removeRoleById, timeoutMember, banMember, unbanMember } from "@/app/lib/discord-api";

async function getActorRole(): Promise<StaffRole> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/dashboard");
  const role = await getStaffRole(session.userId);
  if (!role) redirect("/dashboard");
  if (!(await hasMfaEnabled(session.userId))) redirect("/dashboard");
  return role;
}

function canActOn(actorRole: StaffRole, targetRole: StaffRole | null): boolean {
  if (actorRole === "ceo") return true;
  if (actorRole === "director") return targetRole !== "director" && targetRole !== "ceo";
  return targetRole === null; // moderator can only act on non-staff
}

async function removeFromActivePlay(accountId: string) {
  // No-op if this account has no Tier 3 (players) row yet — e.g. a rejected
  // registration being kicked for a resubmission cooldown never had a roster spot.
  await supabaseAdmin.from("players").update({
    team_id: null,
    is_captain: false,
    draft_entered: false,
    in_active_draft: false,
    updated_at: new Date().toISOString(),
  }).eq("account_id", accountId);

  const { data: activeTournaments } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .in("status", ["scheduled", "active"]);
  if (activeTournaments?.length) {
    await supabaseAdmin
      .from("tournament_entries")
      .delete()
      .eq("player_id", accountId)
      .in("tournament_id", activeTournaments.map((t) => t.id));
  }
}

export async function kickPlayer(
  accountId: string,
  reason: string,
  timeoutMs: number = 7 * 24 * 60 * 60 * 1000,
  kickedUntil: Date | null = null
): Promise<{ ok?: boolean; error?: string }> {
  const actorRole = await getActorRole();

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("discord_id")
    .eq("id", accountId)
    .single();
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("account_id", accountId)
    .single();

  const targetRole = account?.discord_id ? await getStaffRole(account.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: "You don't have permission to moderate this user." };

  await removeFromActivePlay(accountId);
  const { error } = await supabaseAdmin
    .from("accounts")
    .update({
      kick_reason: reason.trim() || null,
      kicked_until: kickedUntil ? kickedUntil.toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return { error: error.message };

  if (account?.discord_id && !account.discord_id.startsWith("test_")) {
    const discordId = account.discord_id;
    const teamId = player?.team_id ?? null;
    const roleRemovals: Promise<unknown>[] = [removeRole(discordId, "Captain")];
    if (teamId) {
      const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamId).single();
      if (team?.discord_role_id) roleRemovals.push(removeRoleById(discordId, team.discord_role_id));
    }
    await Promise.all(roleRemovals);
    await addRole(discordId, "Kicked");
    await timeoutMember(discordId, timeoutMs);
    await invalidatePlayerSessions(discordId);
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}

export type RejectionCooldown = "5m" | "1d" | "forever";

// Reused by rejectPlatformAccount for the optional cooldown on a rejected
// platform-account claim. "forever" reuses kickPlayer's default (permanent
// kick_reason, no kicked_until, standard Discord timeout) — same broad kick
// as the moderation panel. "5m"/"1d" set kicked_until to match, and size the
// Discord timeout to the same window so the two don't disagree.
export async function kickForRejectionCooldown(
  accountId: string,
  reason: string,
  cooldown: RejectionCooldown
): Promise<{ ok?: boolean; error?: string }> {
  if (cooldown === "forever") return kickPlayer(accountId, reason);
  const ms = cooldown === "5m" ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return kickPlayer(accountId, reason, ms, new Date(Date.now() + ms));
}

// Surfaced to the admin after a ban so they know a pledge is still live.
// Patreon v2 is read-only for memberships, so nothing here can cancel it — the
// only thing that stops the charge is a director blocking them on patreon.com.
export type RevokedPatron = { tierTitle: string | null; entitledCents: number | null };

export async function banPlayer(
  accountId: string,
  reason: string
): Promise<{ ok?: boolean; error?: string; revokedPatron?: RevokedPatron }> {
  const actorRole = await getActorRole();

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select(
      "discord_id, patreon_status, patreon_tier_title, patreon_entitled_cents, patreon_tier_override",
    )
    .eq("id", accountId)
    .single();
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("account_id", accountId)
    .single();

  const targetRole = account?.discord_id ? await getStaffRole(account.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: "You don't have permission to moderate this user." };

  await removeFromActivePlay(accountId);
  const { error } = await supabaseAdmin
    .from("accounts")
    .update({
      status: "banned",
      ban_reason: reason.trim() || null,
      kick_reason: null,
      kicked_until: null,
      // A ban revokes supporter status at every level, free members included
      // — it is the link being severed, not a pledge threshold. A kick
      // deliberately does not do this.
      ...revokedPatronFields(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return { error: error.message };

  // Mirror onto the Tier 3 row (no-op if this account has no players row) —
  // several call sites that predate the tier model still filter directly on
  // players.status ("approved") rather than joining accounts: pushToAllApproved/
  // pushToTeam/pushToEnteredDraft in app/lib/push.ts, computeTopStats in
  // app/lib/game-stats.ts, and the champion-roster check in
  // app/dashboard/podium/page.tsx. Without this they'd keep treating a banned
  // player as an approved one. Requires players_status_check to allow 'banned'
  // (see scripts/players-banned-status-migration.sql).
  await supabaseAdmin
    .from("players")
    .update({ status: "banned", updated_at: new Date().toISOString() })
    .eq("account_id", accountId);

  if (account?.discord_id && !account.discord_id.startsWith("test_")) {
    const discordId = account.discord_id;
    const teamId = player?.team_id ?? null;
    const roleRemovals: Promise<unknown>[] = [
      removeRegisteredRole(discordId),
      removeRole(discordId, "Captain"),
      removeRole(discordId, "Kicked"),
    ];
    if (teamId) {
      const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamId).single();
      if (team?.discord_role_id) roleRemovals.push(removeRoleById(discordId, team.discord_role_id));
    }
    await Promise.all(roleRemovals);
    await banMember(discordId); // server ban — removes them from the guild
    await invalidatePlayerSessions(discordId);
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  revalidatePath("/dashboard/support");

  const wasPatron = account?.patreon_status === "active_patron" || account?.patreon_tier_override != null;
  return {
    ok: true,
    ...(wasPatron
      ? {
          revokedPatron: {
            tierTitle: ((account?.patreon_tier_override ?? account?.patreon_tier_title) as string | null) ?? null,
            entitledCents: (account?.patreon_entitled_cents as number | null) ?? null,
          },
        }
      : {}),
  };
}

export async function unkickPlayer(
  accountId: string
): Promise<{ ok?: boolean; error?: string }> {
  const actorRole = await getActorRole();

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("discord_id")
    .eq("id", accountId)
    .single();

  const targetRole = account?.discord_id ? await getStaffRole(account.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: "You don't have permission to moderate this user." };

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
    .select("discord_id")
    .eq("id", accountId)
    .single();

  const targetRole = account?.discord_id ? await getStaffRole(account.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: "You don't have permission to moderate this user." };

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

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}
