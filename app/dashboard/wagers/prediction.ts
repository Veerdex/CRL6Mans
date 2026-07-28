// ── Rating math ─────────────────────────────────────────────────────────────
// The per-game curve and roster-aggregation math live in app/lib/rating.ts so
// the season updater and this predictor read a rating gap the same way.

import { winProbability, initialTeamRating } from "@/app/lib/rating";

function nChooseK(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

function seriesWinProbability(perGameP: number, winsNeeded: number): number {
  let total = 0;
  for (let losses = 0; losses < winsNeeded; losses++) {
    const gamesPlayed = winsNeeded + losses;
    total +=
      nChooseK(gamesPlayed - 1, losses) *
      Math.pow(perGameP, winsNeeded) *
      Math.pow(1 - perGameP, losses);
  }
  return total;
}

function scorelineBreakdown(
  perGameP: number,
  winsNeeded: number,
): { wins: number; losses: number; probability: number }[] {
  const result = [];
  for (let losses = 0; losses < winsNeeded; losses++) {
    const gamesPlayed = winsNeeded + losses;
    result.push({
      wins: winsNeeded,
      losses,
      probability:
        nChooseK(gamesPlayed - 1, losses) *
        Math.pow(perGameP, winsNeeded) *
        Math.pow(1 - perGameP, losses),
    });
  }
  return result;
}

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
  const perGameH = winProbability(homeRating, awayRating);
  const perGameA = 1 - perGameH;

  const homeWinProb = seriesWinProbability(perGameH, winsNeeded);

  const probByGames: Record<number, number> = {};
  for (const b of [
    ...scorelineBreakdown(perGameH, winsNeeded),
    ...scorelineBreakdown(perGameA, winsNeeded),
  ]) {
    const g = b.wins + b.losses;
    probByGames[g] = (probByGames[g] ?? 0) + b.probability;
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
