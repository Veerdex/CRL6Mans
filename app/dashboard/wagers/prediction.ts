// ── Rating math ─────────────────────────────────────────────────────────────
// The per-game curve and roster-aggregation math live in app/lib/rating.ts so
// the season updater and this predictor read a rating gap the same way.

import { predictSeries, initialTeamRating, PREDICTION_SCALE } from "@/app/lib/rating";

// ── Public API ────────────────────────────────────────────────────────────────

export function getOULines(bestOf: number): number[] {
  if (bestOf <= 1) return [];
  if (bestOf <= 3) return [2.5];
  if (bestOf <= 5) return [3.5, 4.5];
  return [4.5, 5.5, 6.5];
}

export function getTotalSlots(bestOf: number): number {
  return 1 + getOULines(bestOf).length;
}

export const HOUSE_VIG = 0.05;

export function payoutMultiplier(prob: number): number {
  const clamped = Math.max(0.01, Math.min(0.99, prob));
  return Math.round(((1 - HOUSE_VIG) / clamped) * 100) / 100;
}

export type MatchPrediction = {
  homeWinProb: number;
  awayWinProb: number;
  ouLines: { line: number; overProb: number; underProb: number }[];
};

function computeFromRatings(homeRating: number, awayRating: number, bestOf: number): MatchPrediction {
  const winsNeeded = Math.ceil(bestOf / 2);
  const { pASeries: homeWinProb, scorelines } = predictSeries(
    homeRating, awayRating, winsNeeded, PREDICTION_SCALE,
  );

  const probByGames: Record<number, number> = {};
  for (const s of scorelines) {
    const g = s.wins + s.losses;
    probByGames[g] = (probByGames[g] ?? 0) + s.probability;
  }

  const ouLines = getOULines(bestOf).map((line) => {
    let overProb = 0;
    let underProb = 0;
    for (const [games, prob] of Object.entries(probByGames)) {
      if (Number(games) > line) overProb += prob;
      else underProb += prob;
    }
    return { line, overProb, underProb };
  });

  return { homeWinProb, awayWinProb: 1 - homeWinProb, ouLines };
}

// Uses pre-computed team ratings (e.g. season_rating from DB) directly.
export function computeMatchPredictionFromRating(
  homeRating: number,
  awayRating: number,
  bestOf: number,
): MatchPrediction {
  return computeFromRatings(homeRating, awayRating, bestOf);
}

// Computes team ratings from raw per-player ratings (calculatePlayerRating
// output), then predicts. Roster aggregation is fixed regardless of stage.
export function computeMatchPrediction(
  homePlayerRatings: number[],
  awayPlayerRatings: number[],
  bestOf: number,
): MatchPrediction {
  return computeFromRatings(
    initialTeamRating(homePlayerRatings),
    initialTeamRating(awayPlayerRatings),
    bestOf,
  );
}
