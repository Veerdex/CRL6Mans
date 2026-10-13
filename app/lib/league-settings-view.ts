// `openReadyMatchChannels` read the single-row `league_settings` three separate
// times — once for the ready-gating flags, once for the channel context, and once
// more inside `getStaffRoleIds()` — and `createMatchChannel`'s no-ctx branch did
// the same. The first two were serial, so the whole sweep paid two full round
// trips for one row.
//
// This module holds the merged column list and one projection per consumer, so a
// single select can feed all three. The projections are pure and must stay exactly
// equivalent to the inline expressions they replaced, defaults included — that
// equivalence is what `scripts/test-league-settings-view.ts` pins.
//
// Deliberately dependency-free: no supabase import, so `node --test` can load it.
// `roundBestOf` is threaded through as a type parameter rather than imported from
// `app/dashboard/season/format-constants`, which would drag a path alias into the
// test build for a type that is only ever passed along untouched.

export type LeagueSettingsRow<RB = unknown> = {
  active_tournament_id?: string | null;
  round1_manual_start_pending?: boolean | null;
  match_deadline_day?: number | null;
  match_play_day?: number | null;
  match_play_hour?: number | null;
  rules_channel_id?: string | null;
  match_category_anchor_id?: string | null;
  season_format?: { roundBestOf?: RB } | null;
  moderator_role_id?: string | null;
  director_role_id?: string | null;
  ceo_role_id?: string | null;
};

// Every column the three consumers below read, as one select string.
export const LEAGUE_SETTINGS_CHANNEL_COLUMNS =
  "active_tournament_id, round1_manual_start_pending, match_deadline_day, match_play_day, " +
  "match_play_hour, rules_channel_id, match_category_anchor_id, season_format, " +
  "moderator_role_id, director_role_id, ceo_role_id";

export function readyGating(row: LeagueSettingsRow | null | undefined): {
  activeTournamentId: string | null;
  round1ManualStartPending: boolean;
} {
  return {
    activeTournamentId: row?.active_tournament_id ?? null,
    round1ManualStartPending: !!row?.round1_manual_start_pending,
  };
}

export function channelContext<RB>(row: LeagueSettingsRow<RB> | null | undefined): {
  deadlineDay: number;
  playDay: number;
  playHour: number;
  rulesChannelId: string | null;
  categoryAnchorId: string | null;
  roundBestOf: RB;
  isTournament: boolean;
} {
  return {
    deadlineDay: row?.match_deadline_day ?? 2,
    playDay: row?.match_play_day ?? 0,
    playHour: row?.match_play_hour ?? 19,
    rulesChannelId: row?.rules_channel_id ?? null,
    categoryAnchorId: row?.match_category_anchor_id ?? null,
    roundBestOf: row?.season_format?.roundBestOf ?? ({} as RB),
    isTournament: !!row?.active_tournament_id,
  };
}

// Flat list in moderator → director → ceo order, matching getStaffRoleIds().
export function staffRoleIdsFrom(row: LeagueSettingsRow | null | undefined): string[] {
  return [row?.moderator_role_id, row?.director_role_id, row?.ceo_role_id].filter(
    (id): id is string => !!id,
  );
}
