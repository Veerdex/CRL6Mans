import { invalidatePlayerSessions } from "./session";
import { getStaffRole, removeRegisteredRole, type StaffRole } from "./players";
import { supabaseAdmin } from "./supabase";
import { revokedPatronFields } from "./patreon-sync";
import { syncDiscordSupporterRole } from "./patreon-discord-role";
import { addRole, removeRole, removeRoleById, timeoutMember, banMember } from "./discord-api";

// The kick/ban rules themselves, with no session in sight, so the Discord bot
// and the admin panel's server actions can share one implementation instead of
// drifting copies. Each caller resolves the actor's staff role its own way —
// cookie session on the site, invoking member on the bot — and passes it in.
// Cache revalidation stays with the server actions; this module never imports
// next/cache.

export const DEFAULT_KICK_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export function canActOn(actorRole: StaffRole, targetRole: StaffRole | null): boolean {
  if (actorRole === "ceo") return true;
  if (actorRole === "director") return targetRole !== "director" && targetRole !== "ceo";
  return targetRole === null; // moderator can only act on non-staff
}

export async function removeFromActivePlay(accountId: string) {
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

// Surfaced to the admin after a ban so they know a pledge is still live.
// Patreon v2 is read-only for memberships, so nothing here can cancel it — the
// only thing that stops the charge is a director blocking them on patreon.com.
export type RevokedPatron = { tierTitle: string | null; entitledCents: number | null };

export const NO_PERMISSION = "You don't have permission to moderate this user.";

export async function kickAccount(
  actorRole: StaffRole,
  accountId: string,
  reason: string,
  timeoutMs: number = DEFAULT_KICK_TIMEOUT_MS,
  kickedUntil: Date | null = null
): Promise<{ ok?: boolean; error?: string }> {
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
  if (!canActOn(actorRole, targetRole)) return { error: NO_PERMISSION };

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

  return { ok: true };
}

export async function banAccount(
  actorRole: StaffRole,
  accountId: string,
  reason: string
): Promise<{ ok?: boolean; error?: string; revokedPatron?: RevokedPatron }> {
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
  if (!canActOn(actorRole, targetRole)) return { error: NO_PERMISSION };

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
      // banMember below removes them from the guild outright, which takes the
      // supporter role with it — this is the belt for the case where the ban
      // call fails and they stay in the server.
      syncDiscordSupporterRole(discordId),
    ];
    if (teamId) {
      const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamId).single();
      if (team?.discord_role_id) roleRemovals.push(removeRoleById(discordId, team.discord_role_id));
    }
    await Promise.all(roleRemovals);
    await banMember(discordId); // server ban — removes them from the guild
    await invalidatePlayerSessions(discordId);
  }

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

// The admin panel already knows an account id for every row it renders; the bot
// starts from a Discord snowflake and has to find one.
export type ModerationTarget = { accountId: string; status: string | null; displayName: string };

export async function findAccountByDiscordId(discordId: string): Promise<ModerationTarget | null> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("id, status, username, display_name")
    .eq("discord_id", discordId)
    .single();
  if (!data) return null;
  return {
    accountId: data.id as string,
    status: (data.status as string | null) ?? null,
    displayName: ((data.display_name ?? data.username) as string | null) ?? discordId,
  };
}
