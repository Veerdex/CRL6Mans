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

// How fast a ranked move stops passing through as the adjustment grows: at a
// gap of ABSORB_SCALE RV a move toward the adjusted rating passes ~1/e through.
export const ABSORB_SCALE = 100;

/**
 * The adjustment left after a player's MMR rating moves from `oldMmrRv` to
 * `newMmrRv`. A move toward the adjusted rating is the ladder confirming what
 * the stats already said, so each RV of it passes through at e^(-gap/ABSORB_SCALE),
 * the gap being the adjustment at that instant: 1:1 with no adjustment, barely
 * at all with a large one. That is integrated over the move, so one edit and
 * the same edit split in two land in the same place, and the gap shrinks toward
 * zero without crossing it. A move away from the adjusted rating passes through
 * 1:1 and leaves the adjustment alone — damping it too would floor a player
 * whose ladder rank collapses, and cap one whose early stats undersold them.
 */
export function absorbMmrChange(adjustment: number, oldMmrRv: number, newMmrRv: number): number {
  const delta = newMmrRv - oldMmrRv;
  if (adjustment === 0 || delta === 0 || Math.sign(delta) !== Math.sign(adjustment)) return adjustment;
  const gap = Math.abs(adjustment) / ABSORB_SCALE;
  const left = ABSORB_SCALE * Math.log1p(Math.expm1(gap) * Math.exp(-Math.abs(delta) / ABSORB_SCALE));
  return Math.sign(adjustment) * left;
}

/**
 * The MMR rating a seeded adjustment was measured against, kept while the row
 * has no MMR on file — a past season's adjustment usually lands on a player
 * before their first join confirmation, and without it that first entry could
 * not tell a returning player who climbed from one who didn't.
 */
export type AdjustmentBasisRow = PlayerRatingRow & { rv_adjustment_basis?: string | number | null };

/**
 * Every MMR writer goes through this: the adjustment to store alongside `next`,
 * given the row as it was. `before` must have been selected with rv_adjustment
 * and rv_adjustment_basis, and the writer clears the basis in the same update.
 */
export function adjustmentAfterMmrEdit(before: AdjustmentBasisRow, next: PlayerRatingRow): number {
  const adjustment = Number(before.rv_adjustment ?? 0);
  if (hasMmrOnFile(before)) return absorbMmrChange(adjustment, mmrRatingFromRow(before), mmrRatingFromRow(next));
  // A first entry over the all-zero default is no ladder movement in itself,
  // and measured from 0 would wipe any positive adjustment in one save; it is
  // movement only against the rating the adjustment was earned at.
  const basis = before.rv_adjustment_basis;
  if (basis === null || basis === undefined || !hasMmrOnFile(next)) return adjustment;
  return absorbMmrChange(adjustment, Number(basis), mmrRatingFromRow(next));
}
