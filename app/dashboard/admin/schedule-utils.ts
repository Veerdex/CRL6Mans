// Pure utilities for round scheduling — no server dependencies, safe to import anywhere.

export type ScheduleType = "range" | "specific";

export type RoundScheduleRow = {
  stage: string;
  round: number;
  scheduleType: ScheduleType;
  playAt: string;
  deadlineAt: string;
  rangeDays: number | null;
};

export function canonicalStage(stage: string): string {
  return stage.startsWith("group_") ? "group" : stage;
}

export const STAGE_ORDER = [
  "group",
  "se_qualifier",
  "deq_winners",
  "deq_losers",
  "swiss",
  "single_elimination",
  "de_winners",
  "de_losers",
  "de_grand_final",
  "hybrid_ub",
  "hybrid_lb",
  "hybrid_sf",
  "hybrid_gf",
  "hybrid8_ub",
  "hybrid8_lb",
  "hybrid8_sf",
  "hybrid8_gf",
];

// ── Expected stages/rounds from the format config ────────────────────────────────
// Predicts the canonical stages and round counts a format will produce BEFORE the
// brackets are generated, so the scheduler can show every stage up front.
// Round-count math must stay in sync with app/lib/bracket.ts.

function nextPow2(n: number): number { let p = 1; while (p < n) p *= 2; return p; }
function numGroupsFor(teams: number): number { return teams > 32 ? 8 : teams > 16 ? 4 : 2; }
function defaultGroupAdvancing(teams: number): number {
  const ng = numGroupsFor(teams);
  const natural = Math.floor((teams * 3) / 4);
  return Math.floor(natural / ng) * ng;
}
function groupRounds(teams: number, ng: number): number {
  const size = Math.ceil(teams / ng);
  return size % 2 === 0 ? size - 1 : size; // round-robin: m-1 (even) / m (odd, bye)
}
function seRounds(start: number, end: number): number {
  return Math.max(0, Math.round(Math.log2(nextPow2(start) / end)));
}

const PRESET_MIN_TEAMS: Record<string, number> = {
  single_elimination: 4, double_elimination: 4,
  group_single_elimination: 8, group_swiss_single_elimination: 32,
  group_swiss_hybrid: 24, group_swiss_hybrid_8: 16,
  se_swiss_single_elimination: 32, de_swiss_single_elimination: 32,
};
const PRESET_MAX_TEAMS: Record<string, number> = {
  group_single_elimination: 64, group_swiss_single_elimination: 64,
  group_swiss_hybrid: 32, group_swiss_hybrid_8: 32,
};

export function expectedStageRounds(
  preset: string,
  teams: number,
  groupMaxAdvancing: number | null,
): { stage: string; rounds: number }[] {
  const min = PRESET_MIN_TEAMS[preset];
  if (min !== undefined && teams < min) return [];
  const max = PRESET_MAX_TEAMS[preset];
  const t = max !== undefined ? Math.min(teams, max) : teams;
  const ng = numGroupsFor(t);

  switch (preset) {
    case "single_elimination":
      return [{ stage: "single_elimination", rounds: seRounds(t, 1) }];
    case "double_elimination": {
      const size = nextPow2(t);
      return [
        { stage: "de_winners", rounds: Math.log2(size) },
        { stage: "de_losers", rounds: 2 * (Math.log2(size) - 1) },
        { stage: "de_grand_final", rounds: 1 },
      ];
    }
    case "group_single_elimination": {
      const adv = groupMaxAdvancing ?? defaultGroupAdvancing(t);
      return [
        { stage: "group", rounds: groupRounds(t, ng) },
        { stage: "single_elimination", rounds: seRounds(adv, 1) },
      ];
    }
    case "group_swiss_single_elimination":
      return [
        { stage: "group", rounds: groupRounds(t, ng) },
        { stage: "swiss", rounds: 5 },
        { stage: "single_elimination", rounds: 3 },
      ];
    case "group_swiss_hybrid":
      return [
        { stage: "group", rounds: groupRounds(t, ng) },
        { stage: "swiss", rounds: 5 },
        { stage: "hybrid_ub", rounds: 1 },
        { stage: "hybrid_lb", rounds: 3 },
        { stage: "hybrid_sf", rounds: 1 },
        { stage: "hybrid_gf", rounds: 1 },
      ];
    case "group_swiss_hybrid_8":
      return [
        { stage: "group", rounds: groupRounds(t, ng) },
        { stage: "swiss", rounds: 3 },
        { stage: "hybrid8_ub", rounds: 1 },
        { stage: "hybrid8_lb", rounds: 2 },
        { stage: "hybrid8_sf", rounds: 1 },
        { stage: "hybrid8_gf", rounds: 1 },
      ];
    case "se_swiss_single_elimination":
      return [
        { stage: "se_qualifier", rounds: seRounds(t, 16) },
        { stage: "swiss", rounds: 5 },
        { stage: "single_elimination", rounds: 3 },
      ];
    case "de_swiss_single_elimination": {
      const size = nextPow2(t);
      const k = Math.round(Math.log2(size / 8)); // half of 16 alive per bracket
      return [
        { stage: "deq_winners", rounds: k },
        { stage: "deq_losers", rounds: 2 * (k - 1) },
        { stage: "swiss", rounds: 5 },
        { stage: "single_elimination", rounds: 3 },
      ];
    }
    default:
      return [];
  }
}

export function stageName(stage: string): string {
  const names: Record<string, string> = {
    group: "Group Stage",
    se_qualifier: "SE Qualifier",
    deq_winners: "DE Qualifier — Winners",
    deq_losers: "DE Qualifier — Losers",
    swiss: "Swiss",
    single_elimination: "Single Elimination",
    de_winners: "Winners Bracket",
    de_losers: "Losers Bracket",
    de_grand_final: "Grand Final",
    hybrid_ub: "Upper Bracket",
    hybrid_lb: "Lower Bracket",
    hybrid_sf: "Semifinals",
    hybrid_gf: "Grand Final",
    hybrid8_ub: "Upper Bracket",
    hybrid8_lb: "Lower Bracket",
    hybrid8_sf: "Semifinals",
    hybrid8_gf: "Grand Final",
  };
  return names[stage] ?? stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
