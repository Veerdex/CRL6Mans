// ── Stats-driven RV adjustment ────────────────────────────────────────────────
// Pure leaf (no Supabase import) so `node --test` can load it.
//
// A player's displayed RV is their MMR rating plus `players.rv_adjustment`.
// After every stats-tracked series the adjustment moves toward whatever RV the
// player's fantasy points implied, weighted by series length and by how many
// series the player has already been measured over. See
// docs/fantasy-projections.md for the projection model these constants come from.

import { mmrRatingFromRow, type PlayerRatingRow } from "./rating";
import { hasMmrOnFile } from "./mmr-on-file";

export const FP_BASELINE_RV = 1722.4;

// Per-game league means at FP_BASELINE_RV, and how much each rises per RV point.
const STAT_MEAN = { score: 345.55, goals: 0.70027, assists: 0.52663, saves: 1.35992, shots: 2.47082 };
const STAT_SLOPE = { score: 0.3810, goals: 0.000928, assists: 0.000185, saves: 0.001646, shots: 0.002389 };
const HISTORY_PRIOR_GAMES = 10;

// RV per point of FP surprise. Fitted as RV-on-FP (R² × the inverse of the
// 0.001019 FP-on-RV slope) rather than by inverting the projection line, which
// would overstate every surprise by 1/R².
export const RV_PER_FP = 687;
// A series counts as games/(games + SERIES_PRIOR_GAMES) of a reliable sample.
export const SERIES_PRIOR_GAMES = 7;
// The counter stops here, so an established player's newest series keeps 1/7 weight.
export const SERIES_PLAYED_CAP = 5;

export type StatLine = { score: number; goals: number; assists: number; saves: number; shots: number };
/**
 * `scoreGames` is how many of `games` recorded a score: two seeded past events
 * have none, and counting them would read as a player scoring 0 every game.
 * Absent means all of them.
 */
export type StatTotals = StatLine & { games: number; scoreGames?: number };

const STATS = ["score", "goals", "assists", "saves", "shots"] as const;

export function fantasyPoints(s: StatLine): number {
  return (s.score + 250 * s.goals + 85 * s.assists + 60 * s.saves + 10 * s.shots) / 660;
}

/** Per-game stat line expected of an RV, blended with the player's own history. */
export function projectedStatLine(rv: number, history: StatTotals | null): StatLine {
  const out = {} as StatLine;
  for (const k of STATS) {
    const games = Math.max(0, (k === "score" ? history?.scoreGames : undefined) ?? history?.games ?? 0);
    const w = games / (games + HISTORY_PRIOR_GAMES);
    const fromRating = Math.max(0, STAT_MEAN[k] + STAT_SLOPE[k] * (rv - FP_BASELINE_RV));
    out[k] = games > 0 ? w * (history![k] / games) + (1 - w) * fromRating : fromRating;
  }
  return out;
}

export function projectedFantasyPoints(rv: number, history: StatTotals | null): number {
  return fantasyPoints(projectedStatLine(rv, history));
}

export type AdjustmentState = { adjustment: number; seriesPlayed: number };

/**
 * One series' update. `predictedFP` and `actualFP` are per game; `games` is how
 * many of the series' games the player appeared in.
 */
export function applySeriesResult(
  state: AdjustmentState,
  predictedFP: number,
  actualFP: number,
  games: number,
): AdjustmentState & { delta: number } {
  if (games <= 0) return { ...state, delta: 0 };
  const n = Math.min(Math.max(0, state.seriesPlayed), SERIES_PLAYED_CAP);
  const delta =
    RV_PER_FP * (actualFP - predictedFP) * (games / (games + SERIES_PRIOR_GAMES)) * (1 / (n + 2));
  return {
    adjustment: state.adjustment + delta,
    seriesPlayed: Math.min(n + 1, SERIES_PLAYED_CAP),
    delta,
  };
}

/**
 * The adjustment left after a player's MMR rating moves from `oldMmrRv` to
 * `newMmrRv`. A move in the adjustment's own direction is the ranked ladder
 * confirming what the stats already said, so it uses the adjustment up rather
 * than stacking on it; a move the other way leaves it alone. Re-saving the same
 * values therefore changes nothing, and no edit can wipe a negative adjustment.
 */
export function absorbMmrChange(adjustment: number, oldMmrRv: number, newMmrRv: number): number {
  const delta = newMmrRv - oldMmrRv;
  if (adjustment === 0 || delta === 0 || Math.sign(delta) !== Math.sign(adjustment)) return adjustment;
  const used = Math.min(Math.abs(delta), Math.abs(adjustment));
  return adjustment - Math.sign(adjustment) * used;
}

/**
 * Every MMR writer goes through this: the adjustment to store alongside `next`,
 * given the row as it was. `before` must have been selected with rv_adjustment.
 */
export function adjustmentAfterMmrEdit(before: PlayerRatingRow, next: PlayerRatingRow): number {
  // A first entry over the all-zero default is no ladder movement at all, and
  // would otherwise wipe any positive adjustment in one save.
  if (!hasMmrOnFile(before)) return Number(before.rv_adjustment ?? 0);
  return absorbMmrChange(Number(before.rv_adjustment ?? 0), mmrRatingFromRow(before), mmrRatingFromRow(next));
}
