// ── CRL 6Mans rating model (crl-game-share-elo-v1) ──────────────────────────
// Pure, side-effect-free rating math shared by the season updater
// (app/lib/discord-bot.ts) and the wager predictor (app/dashboard/wagers/
// prediction.ts) so both interpret a rating gap identically. No DB access,
// no server-only imports — safe to pull into client bundles.
//
// wagers-prediction-explainer.txt describes an older, no-longer-accurate
// version of this model — this file and its call sites are the source of truth.

// Player RV → power rating. Sigmoid-weighted below the join point, linear above
// it so a genuine carry keeps scaling without an upper ceiling. Continuous at
// JOIN_POINT_RV (rv*sigmoid there ≈ JOIN_VALUE).
const JOIN_POINT_RV = 1850;
const JOIN_VALUE = 1758.38;
const ABOVE_SLOPE = 0.91;

// Roster-aggregation power mean is fixed regardless of stage — there's only
// one way to turn a roster's RVs into a team rating.
const POWER_MEAN_P = 9.0;

// Rating-update parameters. Fixed regardless of stage — the model is a single,
// consistent game-by-game Elo update applied identically whether the match is
// in Group, Swiss, or any elimination stage.
const RATING_K = 35;
const ELO_CONFIDENCE = 1.5;

// Shared expected-game curve scale.
const PER_GAME_SCALE = 650;

// Hidden series-probability calibration multiplier for the display/wager-odds
// path only (app/dashboard/wagers/prediction.ts). Deliberately independent of
// ELO_CONFIDENCE above — raising this sharpens shown probabilities without
// exaggerating actual season_rating movement on the update path.
export const PREDICTION_CONFIDENCE = 1.92;

export function rvToPower(rv: number): number {
  const v = Number.isFinite(rv) && rv > 0 ? rv : 0;
  const sigmoid = 1 / (1 + Math.exp(-(v - 1200) / 220));
  if (v <= JOIN_POINT_RV) return v * sigmoid;
  return JOIN_VALUE + ABOVE_SLOPE * (v - JOIN_POINT_RV);
}

// Generalized power mean of the roster's player powers. Pads a short roster to
// three spots with the roster average so <3-player teams degrade gracefully.
export function teamRatingFromRVs(rvs: number[], p: number = POWER_MEAN_P): number {
  const filled = rvs.filter((v) => Number.isFinite(v));
  if (filled.length === 0) return rvToPower(1200);
  const avg = filled.reduce((s, v) => s + v, 0) / filled.length;
  while (filled.length < 3) filled.push(avg);
  const powers = filled.slice(0, 3).map(rvToPower);
  const meanPower = powers.reduce((s, v) => s + Math.pow(v, p), 0) / powers.length;
  return Math.pow(meanPower, 1 / p);
}

// Team A's expected share of a single game, in [0, 1]. Equal ratings → 0.50;
// P(A) + P(B) = 1 by construction.
export function perGameExpected(
  rA: number,
  rB: number,
  confidence: number = ELO_CONFIDENCE,
): number {
  return 1 / (1 + Math.pow(10, -((rA - rB) * confidence) / PER_GAME_SCALE));
}

// Marginal effect on a team's rating from one or more roster members' RVs
// changing (e.g. an approved profile-edit request), evaluated via the same
// power mean used everywhere else in this file. Exact and path-independent:
// splitting a player's change into several smaller approvals, in any order,
// or interleaved with other players' changes, sums to the same total as one
// combined change — each step is `teamRatingFromRVs(new roster) -
// teamRatingFromRVs(old roster)` off the live roster, so the deltas
// telescope. Halved so a single roster re-estimate doesn't swing
// season_rating as hard as a full recompute would.
export function teamRatingDeltaFromRVChange(oldRVs: number[], newRVs: number[]): number {
  return (teamRatingFromRVs(newRVs) - teamRatingFromRVs(oldRVs)) / 2;
}

// Applies one series result. `actual` is game-win share, so a sweep moves the
// ratings more than a 3–2. Floor-safe and exactly zero-sum: the transfer is
// capped so neither rating goes negative and A's gain is exactly B's loss.
export function applyRatingUpdate(
  ratingA: number,
  ratingB: number,
  aWins: number,
  bWins: number,
  ratingK: number = RATING_K,
  eloConfidence: number = ELO_CONFIDENCE,
): { newRatingA: number; newRatingB: number; deltaA: number } {
  const totalGames = aWins + bWins;
  if (totalGames <= 0) return { newRatingA: ratingA, newRatingB: ratingB, deltaA: 0 };

  const actualA = aWins / totalGames;
  const expectedA = perGameExpected(ratingA, ratingB, eloConfidence);
  const rawDelta = ratingK * (actualA - expectedA);
  const deltaA = Math.max(-ratingA, Math.min(ratingB, rawDelta));

  return { newRatingA: ratingA + deltaA, newRatingB: ratingB - deltaA, deltaA };
}
