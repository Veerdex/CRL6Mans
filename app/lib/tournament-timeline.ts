import { computeStageSchedule, type SeasonFormatConfig } from "@/app/dashboard/season/format-constants";

export type TournamentRow = {
  join_mode: string;
  team_assignment: string | null;
  draft_open_at: string | null;
  draft_close_at: string | null;
  draft_start_at: string | null;
  season_start_at: string | null;
};

export function buildTimeline(
  t: TournamentRow,
  showOpen = false,
  endIso: string | null = null
): { label: string; iso: string }[] {
  const isAuto = t.team_assignment === "auto_balance";
  return [
    ...(showOpen && t.draft_open_at ? [{ label: "Sign-ups open", iso: t.draft_open_at }] : []),
    ...(t.draft_close_at ? [{ label: "Sign-ups close", iso: t.draft_close_at }] : []),
    // Auto-balance runs itself the moment sign-ups close, so there is nothing a
    // player needs to show up for and no reason to spend a line on it.
    ...(t.join_mode === "players" && t.draft_start_at && !isAuto
      ? [{ label: "Draft starts", iso: t.draft_start_at }]
      : []),
    ...(t.season_start_at ? [{ label: "Tournament starts", iso: t.season_start_at }] : []),
    ...(endIso ? [{ label: "Tournament ends", iso: endIso }] : []),
  ];
}

export const STAGE_KEY_LABELS: Record<string, string> = {
  groups: "Groups",
  swiss: "Swiss",
  bracket: "Bracket",
  se_qualifier: "SE Qualifier",
  de_qualifier: "DE Qualifier",
};

export function stageStartLabel(key: string, preset: string | null): string {
  if (key === "hybrid") return preset === "group_swiss_hybrid_8" ? "Hybrid(8)" : "Hybrid(12)";
  return STAGE_KEY_LABELS[key] ?? key;
}

// The number of teams a tournament will actually run with, using the same rule
// activateTournamentRuntime applies when it forms them: a player pool makes one
// team per three sign-ups, a team pool is the sign-ups themselves, and either is
// capped by team_limit. Before sign-ups close this moves as people join.
export function projectedTeamCount(
  joinMode: string,
  poolCount: number,
  teamSignupCount: number,
  teamLimit: number | null | undefined
): number {
  const teams = joinMode === "players" ? Math.floor(poolCount / 3) : teamSignupCount;
  return teamLimit && teamLimit > 0 ? Math.min(teams, teamLimit) : teams;
}

// When the last stage is expected to finish: its start time plus the estimated
// duration for that stage at the projected team count. Returns null when the
// admin never set a start for the final stage or the field is too small to
// schedule - a start with no end reads better than a made-up end.
export function projectedEndIso(
  stageStarts: Record<string, string> | null,
  format: SeasonFormatConfig | null,
  teams: number
): string | null {
  if (!stageStarts || !format?.preset) return null;

  const last = Object.entries(stageStarts).reduce<[string, string] | null>(
    (best, entry) => (!best || new Date(entry[1]) > new Date(best[1]) ? entry : best),
    null
  );
  if (!last) return null;

  const schedule = computeStageSchedule(
    format.preset,
    teams,
    format.groupMaxAdvancing ?? null,
    format.roundBestOf ?? {},
    format.groupRounds ?? null
  );
  const stage = schedule.find((s) => s.key === last[0]);
  if (!stage) return null;

  const start = new Date(last[1]);
  if (isNaN(start.getTime())) return null;
  return new Date(start.getTime() + stage.estimatedMinutes * 60_000).toISOString();
}

export function buildStageStarts(
  stageStarts: Record<string, string> | null,
  preset: string | null
): { label: string; iso: string }[] {
  if (!stageStarts) return [];
  return Object.entries(stageStarts)
    .map(([key, iso]) => ({ label: stageStartLabel(key, preset), iso }))
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
}
