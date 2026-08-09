// ── CRL 6Mans rating model (crl-final-rating-v1) ────────────────────────────
// Pure, side-effect-free rating math shared by the season updater
// (app/lib/discord-bot.ts) and the wager predictor (app/dashboard/wagers/
// prediction.ts) so both interpret ratings identically. No DB access,
// no server-only imports — safe to pull into client bundles.
//
// Ports CRL_Rating_Prediction_Algorithm_Pseudocode.txt exactly. 1v1 MMR is
// not part of the model — only 2v2 and 3v3 peak/season MMR feed the rating.

const G = 0.7010212656429836;
const PLAYER_POWER_2V2 = 1.998633623123169;
const PLAYER_POWER_3V3 = 1.817444086074829;
const MULTIPLIER_3V3 = 1.0564093589782715;
const PLAYER_AGGREGATION = 5;

const TOP_TWO_POWER = 0.7856990694999695;
const WEAKEST_WEIGHT = 0.03655501495514598;
// priorScale = 1 in production (Section 8 of the spec) — the initial-rating
// spread compression it describes is a no-op at that value, so it's not
// implemented here.

export const PREDICTION_SCALE = 643.3922991071429;
const UPDATE_SCALE = 3237.496337890625;
const K = 40.476104736328125;
const MARGIN_WEIGHT = 0.6977210324151175;
const FORM_RETENTION = 0.9489016812188285;
const GAME_COUNT_EXPONENT = 0.637790322303772;

function powerMean(values: number[], power: number): number {
  const total = values.reduce((sum, v) => sum + v ** power, 0);
  return (total / values.length) ** (1 / power);
}

export type PlayerRatingInputs = {
  at_2v2: number;
  season_2v2: number;
  at_3v3: number;
  season_3v3: number;
};

export function calculatePlayerRating(row: PlayerRatingInputs): number {
  const twoVTwoRating = powerMean([row.at_2v2, row.season_2v2], PLAYER_POWER_2V2);

  const scaled3v3AllTime = MULTIPLIER_3V3 * row.at_3v3;
  const scaled3v3Season = MULTIPLIER_3V3 * row.season_3v3;
  const threeVThreeRating = powerMean([scaled3v3AllTime, scaled3v3Season], PLAYER_POWER_3V3);

  const twoVTwoWeight = 2 * Math.min(G, 0.5);
  const threeVThreeWeight = 2 - 2 * Math.max(G, 0.5);

  return (
    (twoVTwoWeight * twoVTwoRating ** PLAYER_AGGREGATION +
      threeVThreeWeight * threeVThreeRating ** PLAYER_AGGREGATION) /
    (twoVTwoWeight + threeVThreeWeight)
  ) ** (1 / PLAYER_AGGREGATION);
}

// Single entry point for turning a raw DB player row into a rating — every
// caller across the app should go through this instead of hand-mapping
// peak_*/current_* columns into PlayerRatingInputs itself, so the rating
// formula only has one place to change.
export type PlayerRatingRow = {
  peak_2v2: string | number | null; current_2v2: string | number | null;
  peak_3v3: string | number | null; current_3v3: string | number | null;
};

export function playerRatingFromRow(p: PlayerRatingRow): number {
  return calculatePlayerRating({
    at_2v2: Number(p.peak_2v2 ?? 0),
    season_2v2: Number(p.current_2v2 ?? 0),
    at_3v3: Number(p.peak_3v3 ?? 0),
    season_3v3: Number(p.current_3v3 ?? 0),
  });
}

// A CRL team is exactly three players. When a roster is short or long
// (mid-draft, subs, historical data gaps) we degrade gracefully instead of
// throwing: short rosters are padded with the roster's own average rating,
// long rosters keep only the top three by rating — both re-sorted descending
// before the top-two/weakest split, which depends on strongest/second/weakest
// order.
export function initialTeamRating(playerRatings: number[]): number {
  const finite = playerRatings.filter((v) => Number.isFinite(v) && v > 0);
  const base = finite.length > 0 ? finite : [1200];
  const avg = base.reduce((s, v) => s + v, 0) / base.length;
  const padded = [...base];
  while (padded.length < 3) padded.push(avg);
  const [strongest, second, weakest] = padded.sort((a, b) => b - a).slice(0, 3);

  const topTwoCore = powerMean([strongest, second], TOP_TWO_POWER);
  return (1 - WEAKEST_WEIGHT) * topTwoCore + WEAKEST_WEIGHT * weakest;
}

// Single fallback policy for "what rating should a prediction use for this
// team": the stored season_rating once it exists, otherwise the roster's
// initial rating. Every predictor (live pill, frozen snapshot, bet-time odds,
// standings tiebreak) should call this instead of re-deriving the same `??`.
export function resolveTeamRating(seasonRating: number | null, rosterRatings: number[]): number {
  return seasonRating ?? initialTeamRating(rosterRatings);
}

// Pulls a team's accumulated rating movement back toward its initial rating.
// Run immediately before every evaluated match (Section 10 of the spec).
export function applyFormRetention(currentRating: number, initialRating: number): number {
  return initialRating + FORM_RETENTION * (currentRating - initialRating);
}

export function gameWinProbability(ratingA: number, ratingB: number, scale: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / scale));
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= kk; index++) {
    result = (result * (n - kk + index)) / index;
  }
  return result;
}

// The winner must collect winsNeeded-1 wins and `losses` losses in any order
// before the final game, then win the final game.
function exactSeriesScoreProbability(p: number, losses: number, winsNeeded: number): number {
  return combination(winsNeeded - 1 + losses, losses) * p ** winsNeeded * (1 - p) ** losses;
}

export type SeriesScoreline = {
  winner: "A" | "B";
  wins: number;
  losses: number;
  probability: number;
};

export type SeriesPrediction = {
  pAGame: number;
  pBGame: number;
  pASeries: number;
  pBSeries: number;
  scorelines: SeriesScoreline[];
};

export function predictSeries(
  ratingA: number,
  ratingB: number,
  winsNeeded: number,
  scale: number,
): SeriesPrediction {
  const pAGame = gameWinProbability(ratingA, ratingB, scale);
  const pBGame = 1 - pAGame;

  const scorelines: SeriesScoreline[] = [];
  for (let losses = 0; losses < winsNeeded; losses++) {
    scorelines.push({ winner: "A", wins: winsNeeded, losses, probability: exactSeriesScoreProbability(pAGame, losses, winsNeeded) });
  }
  for (let losses = 0; losses < winsNeeded; losses++) {
    scorelines.push({ winner: "B", wins: winsNeeded, losses, probability: exactSeriesScoreProbability(pBGame, losses, winsNeeded) });
  }

  const pASeries = scorelines
    .filter((s) => s.winner === "A")
    .reduce((sum, s) => sum + s.probability, 0);

  return { pAGame, pBGame, pASeries, pBSeries: 1 - pASeries, scorelines };
}

// Zero-sum rating update from a completed (non-forfeit) series result.
// ratingA/ratingB must already have form retention applied (Section 10).
export function applyRatingUpdate(
  ratingA: number,
  ratingB: number,
  gamesA: number,
  gamesB: number,
  winsNeeded: number,
): { newRatingA: number; newRatingB: number; deltaA: number } {
  const gamesPlayed = gamesA + gamesB;

  const { pAGame: expectedGameShare, pASeries: expectedSeriesWin } = predictSeries(
    ratingA, ratingB, winsNeeded, UPDATE_SCALE,
  );

  const binaryOutcome = gamesA > gamesB ? 1 : 0;
  const rawObservedShare = gamesA / gamesPlayed;
  const gameEvidence = (gamesPlayed / 7) ** GAME_COUNT_EXPONENT;

  const binarySurprise = binaryOutcome - expectedSeriesWin;
  const marginSurprise = rawObservedShare - expectedGameShare;

  const deltaA = K * ((1 - MARGIN_WEIGHT) * binarySurprise + MARGIN_WEIGHT * gameEvidence * marginSurprise);

  return { newRatingA: ratingA + deltaA, newRatingB: ratingB - deltaA, deltaA };
}

// Marginal effect on a team's rating from one or more roster members' ratings
// changing (e.g. an approved profile-edit request). Exact and path-independent:
// splitting a player's change into several smaller approvals, in any order, or
// interleaved with other players' changes, sums to the same total as one
// combined change — each step is `initialTeamRating(new roster) -
// initialTeamRating(old roster)` off the live roster, so the deltas telescope.
// Halved so a single roster re-estimate doesn't swing season_rating as hard as
// a full recompute would.
export function teamRatingDeltaFromRatingChange(oldRatings: number[], newRatings: number[]): number {
  return (initialTeamRating(newRatings) - initialTeamRating(oldRatings)) / 2;
}
