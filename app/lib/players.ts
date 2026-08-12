import "server-only";
import { supabaseAdmin } from "./supabase";
import { addRole, removeRole, addRoleById, removeRoleById } from "./discord-api";
import { playerRatingFromRow } from "./rating";

export type PlayerStatus = "unregistered" | "pending" | "approved" | "rejected" | "banned";

export type Player = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  status: PlayerStatus;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  peak_1v1: string | null;
  current_1v1: string | null;
  tracker_url: string;
  college_image_url: string;
  draft_entered: boolean;
  created_at: string;
  team_id: string | null;
};

/** kick_reason is a permanent gate unless kicked_until is set and has passed. */
export function isCurrentlyKicked(kickReason: string | null, kickedUntil: string | null): boolean {
  if (!kickReason) return false;
  if (!kickedUntil) return true;
  return new Date(kickedUntil).getTime() > Date.now();
}

// ── Tiered account model ────────────────────────────────────────────────────
// Tier 1 `accounts` is the source of truth for `status`/`display_name`/etc.
// and exists for every Discord login, regardless of registration status.
// Tier 2 `pending_players` (MMR/tracker) and Tier 3 `players` (team/draft)
// are additive rows keyed by `account_id`, present only once someone has
// registered / been approved respectively. A full `Player` is just the
// join of whichever tiers exist for a given account.

type AccountRow = {
  id: string;
  discord_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  status: PlayerStatus;
  created_at: string;
};

type PendingPlayerRow = {
  account_id: string;
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  peak_1v1: string | null;
  current_1v1: string | null;
  college_image_url: string;
  created_at: string;
};

type TierThreePlayerRow = {
  account_id: string;
  team_id: string | null;
  draft_entered: boolean;
};

function toPlayer(
  account: AccountRow,
  pending: PendingPlayerRow | null,
  tier3: TierThreePlayerRow | null
): Player {
  return {
    id: account.id,
    discord_id: account.discord_id,
    username: account.username ?? "",
    display_name: account.display_name,
    avatar: account.avatar,
    status: account.status,
    peak_3v3: pending?.peak_3v3 ?? "0",
    current_3v3: pending?.current_3v3 ?? "0",
    peak_2v2: pending?.peak_2v2 ?? "0",
    current_2v2: pending?.current_2v2 ?? "0",
    peak_1v1: pending?.peak_1v1 ?? null,
    current_1v1: pending?.current_1v1 ?? null,
    tracker_url: pending?.tracker_url ?? "",
    college_image_url: pending?.college_image_url ?? "",
    draft_entered: tier3?.draft_entered ?? false,
    created_at: pending?.created_at ?? account.created_at,
    team_id: tier3?.team_id ?? null,
  };
}

export async function getPlayerStatus(discordId: string): Promise<PlayerStatus> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("status")
    .eq("discord_id", discordId)
    .single();

  if (!data) return "unregistered";
  return data.status as PlayerStatus;
}

export async function getPlayerInfo(discordId: string): Promise<{
  status: PlayerStatus;
  teamId: string | null;
  displayName: string | null;
  isGuest: boolean;
}> {
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("id, status, display_name, is_guest")
    .eq("discord_id", discordId)
    .single();
  if (!account) return { status: "unregistered", teamId: null, displayName: null, isGuest: false };

  let teamId: string | null = null;
  if (account.status === "approved" || account.status === "banned") {
    const { data: player } = await supabaseAdmin
      .from("players")
      .select("team_id")
      .eq("account_id", account.id)
      .single();
    teamId = player?.team_id ?? null;
  }

  return {
    status: account.status as PlayerStatus,
    teamId,
    displayName: (account.display_name as string | null) ?? null,
    isGuest: !!account.is_guest,
  };
}

export async function getApprovedPlayers(): Promise<Player[]> {
  const { data: accounts } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, username, display_name, avatar, status, created_at")
    .eq("status", "approved");
  if (!accounts || accounts.length === 0) return [];

  const accountIds = accounts.map((a) => a.id);
  const [{ data: pendingRows }, { data: playerRows }] = await Promise.all([
    supabaseAdmin
      .from("pending_players")
      .select("account_id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, peak_1v1, current_1v1, college_image_url, created_at")
      .in("account_id", accountIds),
    supabaseAdmin.from("players").select("account_id, team_id, draft_entered").in("account_id", accountIds),
  ]);

  const pendingByAccount = new Map((pendingRows ?? []).map((r) => [r.account_id, r as PendingPlayerRow]));
  const tier3ByAccount = new Map((playerRows ?? []).map((r) => [r.account_id, r as TierThreePlayerRow]));

  const players = accounts.map((a) =>
    toPlayer(a as AccountRow, pendingByAccount.get(a.id) ?? null, tier3ByAccount.get(a.id) ?? null)
  );

  const ratingOf = (p: Player) => playerRatingFromRow(p);

  return players.sort((a, b) => ratingOf(b) - ratingOf(a));
}

export async function getAllPendingPlayers(): Promise<Player[]> {
  const { data: pendingRows } = await supabaseAdmin
    .from("pending_players")
    .select("account_id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, college_image_url, created_at")
    .order("created_at", { ascending: true });
  if (!pendingRows || pendingRows.length === 0) return [];

  const accountIds = pendingRows.map((r) => r.account_id);
  const { data: accounts } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, username, display_name, avatar, status, created_at")
    .eq("status", "pending")
    .in("id", accountIds);

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a as AccountRow]));

  return pendingRows
    .filter((r) => accountById.has(r.account_id))
    .map((r) => toPlayer(accountById.get(r.account_id)!, r as PendingPlayerRow, null));
}

export async function updatePlayerStatus(
  accountId: string,
  status: "approved" | "rejected"
): Promise<{ discordId: string | null }> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .select("discord_id")
    .single();
  return { discordId: data?.discord_id ?? null };
}

// ── Registered role ───────────────────────────────────────────────────────────
// Granted on approval, stripped on ban. Prefers the role ID configured by
// /setregisteredrole; falls back to resolving by name so the role keeps working
// before an admin ever runs the command.

const REGISTERED_ROLE_NAME = "Registered";

async function getRegisteredRoleId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("registered_role_id")
    .single();
  return (data?.registered_role_id as string | null) ?? null;
}

export async function addRegisteredRole(discordId: string): Promise<void> {
  const roleId = await getRegisteredRoleId();
  if (roleId) await addRoleById(discordId, roleId);
  else await addRole(discordId, REGISTERED_ROLE_NAME);
}

export async function removeRegisteredRole(discordId: string): Promise<void> {
  const roleId = await getRegisteredRoleId();
  if (roleId) await removeRoleById(discordId, roleId);
  else await removeRole(discordId, REGISTERED_ROLE_NAME);
}

export type StaffRole = "moderator" | "director" | "ceo";

export async function getStaffRole(discordId: string): Promise<StaffRole | null> {
  const { data } = await supabaseAdmin
    .from("staff_roles")
    .select("role")
    .eq("discord_id", discordId)
    .single();
  return (data?.role as StaffRole) ?? null;
}

export async function isModerator(discordId: string): Promise<boolean> {
  const role = await getStaffRole(discordId);
  return role !== null;
}

export async function isDirector(discordId: string): Promise<boolean> {
  const role = await getStaffRole(discordId);
  return role === "director" || role === "ceo";
}

export async function isCEO(discordId: string): Promise<boolean> {
  const role = await getStaffRole(discordId);
  return role === "ceo";
}

// ── Website 2FA gate ────────────────────────────────────────────────────────
// Discord's guild-level "Require 2FA for moderation" only guarantees a staff
// member's Discord account has 2FA enabled as a prerequisite for holding that
// role — it doesn't force a live 2FA challenge on this site's own OAuth login,
// and it does nothing for this site's own session cookie once issued. So the
// website enforces its own check against `accounts.mfa_enabled`, refreshed from
// Discord's `mfa_enabled` field on every login (see the OAuth callback).
//
// These *Verified variants are for gating the acting user's own permissions on
// the website only (verifyAdmin-style checks, and the UI flags that mirror
// them) — never for resolving a target player's role (canActOn hierarchy
// checks must keep using getStaffRole/isModerator/isDirector/isCEO directly,
// since an unverified director must not be treated as non-staff for that
// purpose). Also not used by the Discord bot's own slash-command permission
// checks — those are a separate surface this task doesn't cover.
export async function hasMfaEnabled(discordId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("mfa_enabled")
    .eq("discord_id", discordId)
    .single();
  return !!data?.mfa_enabled;
}

export async function isModeratorVerified(discordId: string): Promise<boolean> {
  return (await isModerator(discordId)) && (await hasMfaEnabled(discordId));
}

export async function isDirectorVerified(discordId: string): Promise<boolean> {
  return (await isDirector(discordId)) && (await hasMfaEnabled(discordId));
}

export async function isCEOVerified(discordId: string): Promise<boolean> {
  return (await isCEO(discordId)) && (await hasMfaEnabled(discordId));
}

export { RL_RANKS } from "./ranks";
