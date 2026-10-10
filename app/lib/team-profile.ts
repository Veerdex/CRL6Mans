import "server-only";

import { supabaseAdmin } from "./supabase";
import { playerRatingFromRow, initialTeamRating } from "./rating";

/**
 * Everything one team's popup shows, loaded on demand — the same content as a
 * card on the Teams page, which is what the popup saves a trip to.
 *
 * Deliberately no record and no season_rating. `teams.wins/losses` and
 * `season_rating` are event-scoped live values, while the row a viewer clicks
 * in Standings is computed from that stage's matches only, so showing either
 * here could contradict the number they just clicked.
 *
 * Every column is named explicitly, for the same reason as in player-profile.ts:
 * `accounts` carries ban_reason, kick_reason, mfa_enabled and Patreon tokens,
 * and a `select *` would put all of it one JSON response away from being public.
 */

export type TeamRosterEntry = {
  discordId: string | null;
  username: string;
  displayName: string | null;
  avatar: string | null;
  isCaptain: boolean;
  rankValue: number;
};

export type TeamProfile = {
  id: string;
  name: string;
  logoUrl: string | null;
  logoOffsetX: number;
  logoOffsetY: number;
  isLocked: boolean;
  isDisqualified: boolean;
  /** Carry-weighted team rating, matching the figure the Teams grid shows. */
  teamRv: number;
  roster: TeamRosterEntry[];
};

type TeamRow = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_offset_x: number | null;
  logo_offset_y: number | null;
  is_locked: boolean | null;
  is_disqualified: boolean | null;
};

type RosterRow = {
  id: string;
  is_captain: boolean | null;
  peak_2v2: string | null;
  current_2v2: string | null;
  peak_3v3: string | null;
  current_3v3: string | null;
};

type IdentityRow = {
  id: string;
  discord_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
};

export async function loadTeamProfile(teamId: string): Promise<TeamProfile | null> {
  const { data: team, error } = await supabaseAdmin
    .from("teams")
    .select("id, name, logo_url, logo_offset_x, logo_offset_y, is_locked, is_disqualified")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!team) return null;

  const roster = await loadRoster(teamId);

  return {
    id: (team as TeamRow).id,
    name: (team as TeamRow).name,
    logoUrl: (team as TeamRow).logo_url,
    logoOffsetX: (team as TeamRow).logo_offset_x ?? 50,
    logoOffsetY: (team as TeamRow).logo_offset_y ?? 50,
    isLocked: (team as TeamRow).is_locked ?? false,
    isDisqualified: (team as TeamRow).is_disqualified ?? false,
    // The length guard mirrors teams/page.tsx: initialTeamRating answers 1200
    // for an empty roster, and 0 is what the callers hide the label on.
    teamRv: roster.length ? Math.round(initialTeamRating(roster.map((p) => p.rankValue))) : 0,
    roster,
  };
}

/**
 * Identity comes from Tier 1 even though `players` keeps legacy mirrors of all
 * four columns: nothing but the daily discord-sync writes those mirrors, so a
 * player who renamed today reads correctly only off `accounts`.
 */
async function loadRoster(teamId: string): Promise<TeamRosterEntry[]> {
  const { data: rows, error } = await supabaseAdmin
    .from("players")
    .select("id, is_captain, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("team_id", teamId)
    .eq("status", "approved");
  if (error) throw new Error(error.message);

  const players = (rows ?? []) as RosterRow[];
  if (players.length === 0) return [];

  const { data: identities, error: identityError } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, username, display_name, avatar")
    .in(
      "id",
      players.map((p) => p.id),
    );
  if (identityError) throw new Error(identityError.message);

  const byId = new Map(((identities ?? []) as IdentityRow[]).map((a) => [a.id, a]));

  return players
    .map((p) => {
      const account = byId.get(p.id);
      return {
        discordId: account?.discord_id ?? null,
        username: account?.username ?? "unknown",
        displayName: account?.display_name ?? null,
        avatar: account?.avatar ?? null,
        isCaptain: p.is_captain ?? false,
        rankValue: Math.round(playerRatingFromRow(p)),
      };
    })
    // Captain first, then by rating — the same order as the Teams page rosters.
    .sort((a, b) => {
      if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1;
      return b.rankValue - a.rankValue;
    });
}
