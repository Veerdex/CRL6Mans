// ── Rating math (ported from rl-rating-tracker.jsx) ──────────────────────────

function rvToPower(rv: number): number {
  return 1000 / (1 + Math.exp(-(rv - 1200) / 220));
}

export function teamBaseRating(rv1: number, rv2: number, rv3: number): number {
  return (rvToPower(rv1) + rvToPower(rv2) + rvToPower(rv3)) / 3;
}

function perGameProbability(ratingA: number, ratingB: number): number {
  const diff = ratingA - ratingB;
  return 100 / (1 + Math.pow(10, -diff / 200));
}

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

// Pads an RV array to exactly 3 values by repeating the team average for
// missing roster spots (handles <3 players gracefully).
function padRvs(rvs: number[]): [number, number, number] {
  const filled = [...rvs];
  const avg =
    filled.length > 0
      ? filled.reduce((s, v) => s + v, 0) / filled.length
      : 1200;
  while (filled.length < 3) filled.push(avg);
  return [filled[0], filled[1], filled[2]];
}

function computeFromRatings(homeRating: number, awayRating: number, bestOf: number): MatchPrediction {
  const winsNeeded = Math.ceil(bestOf / 2);
  const perGameH = perGameProbability(homeRating, awayRating) / 100;
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

// Computes team ratings from raw player RVs, then predicts.
export function computeMatchPrediction(
  homeRvs: number[],
  awayRvs: number[],
  bestOf: number,
): MatchPrediction {
  return computeFromRatings(
    teamBaseRating(...padRvs(homeRvs)),
    teamBaseRating(...padRvs(awayRvs)),
    bestOf,
  );
}
