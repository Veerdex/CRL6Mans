export type TournamentRow = {
  join_mode: string;
  team_assignment: string | null;
  draft_open_at: string | null;
  draft_close_at: string | null;
  draft_start_at: string | null;
  season_start_at: string | null;
};

export function buildTimeline(t: TournamentRow, showOpen = false): { label: string; iso: string }[] {
  const isAuto = t.team_assignment === "auto_balance";
  return [
    ...(showOpen && t.draft_open_at ? [{ label: "Sign-ups open", iso: t.draft_open_at }] : []),
    ...(t.draft_close_at ? [{ label: "Sign-ups close", iso: t.draft_close_at }] : []),
    ...(t.join_mode === "players" && t.draft_start_at
      ? [{ label: isAuto ? "Auto-balance executes" : "Draft starts", iso: t.draft_start_at }]
      : []),
    ...(t.season_start_at ? [{ label: "Tournament starts", iso: t.season_start_at }] : []),
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

export function buildStageStarts(
  stageStarts: Record<string, string> | null,
  preset: string | null
): { label: string; iso: string }[] {
  if (!stageStarts) return [];
  return Object.entries(stageStarts)
    .map(([key, iso]) => ({ label: stageStartLabel(key, preset), iso }))
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
}
