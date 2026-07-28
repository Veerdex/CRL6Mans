// ── CRL 6Mans rating model (crl-final-rating-v1) ────────────────────────────
// Pure, side-effect-free rating math shared by the season updater
// (app/lib/discord-bot.ts) and the wager predictor (app/dashboard/wagers/
// prediction.ts) so both interpret ratings identically. No DB access,
// no server-only imports — safe to pull into client bundles.
//
// Ports CRL_Final_Rating_Algorithm.py exactly. winProbability is calibrated
// as a per-game probability (confirmed against the CPS evaluator, which scores
// it directly against raw per-game share sa/(sa+sb)) — callers should NOT
// layer any additional confidence/scale transform on top of it.

const DIRECT_MULTIPLIERS = {
  "1v1": 0.8679660395675698,
  "2v2": 1.0,
  "3v3": 0.62520694090533,
};

const PLAYLIST_WEIGHTS = {
  "1v1": 0.4230321366247228,
  "2v2": 0.5308197709269774,
  "3v3": 1.0,
};

const PLAYER_P = 10.0;
const TEAM_P = 11.406375356976948;
const CARRY_GAP_COEFFICIENT = 0.19904712362301297;

const PREDICTION_SCALE = 300.0;
const BASE_K = 35.0;
const UPDATE_MULTIPLIER = 2.25;
const EFFECTIVE_K = BASE_K * UPDATE_MULTIPLIER;
const SERIES_SCORE_EXPONENT = 0.335;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function convert1v1(value: number): number {
  const x = clamp(value, 100, 1800);
  const converted =
    2.10341072e-12 * x ** 5 -
    9.10728475e-9 * x ** 4 +
    1.323074e-5 * x ** 3 -
    0.00715501759 * x ** 2 +
    2.65919325 * x -
    106.710195;
  return clamp(converted, 100, 2800);
}

function convert3v3(value: number): number {
  const x = clamp(value, 100, 2200);
  const t = (x - 100) / 2100;
  const converted =
    100 +
    2451.55314 * t -
    6221.83456 * t ** 2 +
    42144.0445 * t ** 3 -
    102271.379 * t ** 4 +
    105569.681 * t ** 5 -
    38972.0654 * t ** 6;
  return clamp(converted, 100, 2800);
}

function powerMean(values: number[], weights: number[], p: number): number {
  if (values.length !== weights.length || values.length === 0) {
    throw new Error("values and weights must be non-empty and equally sized");
  }
  if (values.some((v) => v <= 0)) {
    throw new Error("all values must be positive");
  }
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (weights.some((w) => w < 0) || totalWeight <= 0) {
    throw new Error("weights must be non-negative with a positive sum");
  }
  if (p === 0) {
    const sum = values.reduce((s, v, i) => s + weights[i] * Math.log(v), 0);
    return Math.exp(sum / totalWeight);
  }
  const sum = values.reduce((s, v, i) => s + weights[i] * v ** p, 0);
  return (sum / totalWeight) ** (1 / p);
}

export type PlayerRatingInputs = {
  at_1v1: number;
  season_1v1: number;
  at_2v2: number;
  season_2v2: number;
  at_3v3: number;
  season_3v3: number;
};

export function calculatePlayerRating(row: PlayerRatingInputs): number {
  const average1v1 = (row.at_1v1 + row.season_1v1) / 2;
  const average2v2 = (row.at_2v2 + row.season_2v2) / 2;
  const average3v3 = (row.at_3v3 + row.season_3v3) / 2;

  const adjustedValues = [
    convert1v1(average1v1) * DIRECT_MULTIPLIERS["1v1"],
    average2v2 * DIRECT_MULTIPLIERS["2v2"],
    convert3v3(average3v3) * DIRECT_MULTIPLIERS["3v3"],
  ];
  const weights = [PLAYLIST_WEIGHTS["1v1"], PLAYLIST_WEIGHTS["2v2"], PLAYLIST_WEIGHTS["3v3"]];
  return powerMean(adjustedValues, weights, PLAYER_P);
}

// A CRL team is exactly three players. When a roster is short or long
// (mid-draft, subs, historical data gaps) we degrade gracefully instead of
// throwing: short rosters are padded with the roster's own average rating,
// long rosters keep only the top three by rating — both re-sorted descending
// before the carry-gap calculation, which depends on strongest/second/weakest
// order.
export function initialTeamRating(playerRatings: number[]): number {
  const finite = playerRatings.filter((v) => Number.isFinite(v) && v > 0);
  const base = finite.length > 0 ? finite : [1200];
  const avg = base.reduce((s, v) => s + v, 0) / base.length;
  const padded = [...base];
  while (padded.length < 3) padded.push(avg);
  const ratings = padded.sort((a, b) => b - a).slice(0, 3);

  const baseRating = powerMean(ratings, [1, 1, 1], TEAM_P);
  const [strongest, second, weakest] = ratings;
  const carryGap = strongest - (second + weakest) / 2;
  return baseRating + CARRY_GAP_COEFFICIENT * carryGap;
}

// Calibrated as a per-game probability — safe to feed straight into a
// binomial series model with no additional bridging transform.
export function winProbability(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / PREDICTION_SCALE));
}

function seriesUpdateShare(gamesWon: number, gamesLost: number): number {
  if (gamesWon < 0 || gamesLost < 0 || gamesWon + gamesLost === 0) {
    throw new Error("series scores must be non-negative with at least one game");
  }
  const poweredWon = gamesWon ** SERIES_SCORE_EXPONENT;
  const poweredLost = gamesLost ** SERIES_SCORE_EXPONENT;
  return poweredWon / (poweredWon + poweredLost);
}

export function applyRatingUpdate(
  ratingA: number,
  ratingB: number,
  gamesA: number,
  gamesB: number,
): { newRatingA: number; newRatingB: number; deltaA: number } {
  const probabilityA = winProbability(ratingA, ratingB);
  const updateShareA = seriesUpdateShare(gamesA, gamesB);
  const deltaA = EFFECTIVE_K * (updateShareA - probabilityA);
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
