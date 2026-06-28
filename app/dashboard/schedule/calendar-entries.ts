import type { CalEntry } from "./schedule-calendar";
import { canonicalStage } from "@/app/dashboard/admin/schedule-utils";

const STAGE_NAMES: Record<string, string> = {
  group: "Group Stage", swiss: "Swiss", single_elimination: "Single Elimination",
  de_winners: "Winners Bracket", de_losers: "Losers Bracket", de_grand_final: "Grand Final",
  hybrid_ub: "Upper Bracket", hybrid_lb: "Lower Bracket", hybrid_sf: "Semifinals",
  hybrid_gf: "Grand Final", hybrid8_ub: "Upper Bracket", hybrid8_lb: "Lower Bracket",
  hybrid8_sf: "Semifinals", hybrid8_gf: "Grand Final",
};

// Swiss rounds are labelled by the W–L records still alive that round, e.g.
// R1 "0-0", R2 "1-0  0-1", R3 "2-0  1-1  0-2".
function swissRecordLabel(round: number, maxRound: number): string {
  const threshold = Math.ceil((maxRound + 1) / 2);
  const played = round - 1;
  const recs: string[] = [];
  for (let w = played; w >= 0; w--) {
    const l = played - w;
    if (w < threshold && l < threshold) recs.push(`${w}-${l}`);
  }
  return recs.length ? recs.join("  ") : `Round ${round}`;
}

function getRoundDisplayLabel(stage: string, round: number, maxRound: number): string {
  if (stage === "swiss") return swissRecordLabel(round, maxRound);
  if (stage === "single_elimination") {
    const f = maxRound - round;
    if (f === 0) return "Final";
    if (f === 1) return "Semifinals";
    if (f === 2) return "Quarterfinals";
    return `Round ${round}`;
  }
  if (stage === "de_grand_final" || stage.endsWith("_gf")) return "Grand Final";
  if (stage.endsWith("_sf")) return "Semifinals";
  if (stage === "de_winners") return `WB Round ${round}`;
  if (stage === "de_losers") return `LB Round ${round}`;
  if (stage.endsWith("_ub")) return `UB Round ${round}`;
  if (stage.endsWith("_lb")) return `LB Round ${round}`;
  return `Round ${round}`;
}

export type RoundScheduleRow = {
  stage: string;
  round: number;
  scheduleType: string;
  playAt: string;
};

function stageDisplayName(canonStage: string): string {
  return STAGE_NAMES[canonStage] ?? canonStage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildCalEntries(rows: RoundScheduleRow[]): CalEntry[] {
  const maxRoundByStage: Record<string, number> = {};
  for (const s of rows) {
    maxRoundByStage[s.stage] = Math.max(maxRoundByStage[s.stage] ?? 0, s.round);
  }
  return rows.map((s) => ({
    uid: `${s.stage}:${s.round}`,
    stage: s.stage,
    round: s.round,
    scheduleType: s.scheduleType,
    playAt: s.playAt,
    label: getRoundDisplayLabel(s.stage, s.round, maxRoundByStage[s.stage]),
    stageName: stageDisplayName(s.stage),
  }));
}

export type PinnedMatch = {
  id: string;
  stage: string; // raw stage (may be group_N)
  round: number;
  matchNumber: number;
  scheduledAt: string;
};

// Admin-pinned individual matches show as their own fixed-time entries (calendar
// day strips + day-popup timeline), in addition to the round-window bar.
export function buildPinnedMatchEntries(matches: PinnedMatch[], roundRows: RoundScheduleRow[]): CalEntry[] {
  const maxRoundByStage: Record<string, number> = {};
  for (const s of roundRows) {
    maxRoundByStage[s.stage] = Math.max(maxRoundByStage[s.stage] ?? 0, s.round);
  }
  return matches.map((m) => {
    const cs = canonicalStage(m.stage);
    const gm = m.stage.match(/^group_(\d+)$/);
    const base = getRoundDisplayLabel(cs, m.round, maxRoundByStage[cs] ?? m.round);
    const label = gm
      ? `Group ${gm[1]} R${m.round} · M${m.matchNumber}`
      : `${base} · M${m.matchNumber}`;
    return {
      uid: `pm:${m.id}`,
      stage: cs,
      round: m.round,
      scheduleType: "specific",
      playAt: m.scheduledAt,
      label,
      stageName: stageDisplayName(cs),
    };
  });
}
