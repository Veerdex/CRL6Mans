// Golden-number regression tests for app/lib/rating.ts (crl-final-rating-v1),
// checked against the literal spec in CRL_Rating_Prediction_Algorithm_Pseudocode.txt.
//
// Run with: npm run test:rating

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculatePlayerRating,
  initialTeamRating,
  predictSeries,
  applyRatingUpdate,
  applyFormRetention,
  gameWinProbability,
} from "../app/lib/rating";

const CLOSE = 1e-9;

test("player rating is monotonic in every input", () => {
  const base = { at_2v2: 1000, season_2v2: 1000, at_3v3: 1000, season_3v3: 1000 };
  const baseline = calculatePlayerRating(base);
  for (const key of Object.keys(base) as (keyof typeof base)[]) {
    const bumped = calculatePlayerRating({ ...base, [key]: base[key] + 200 });
    assert.ok(bumped > baseline, `raising ${key} should raise the rating`);
  }
});

test("equal 2v2/3v3 inputs collapse to a single scale-consistent value", () => {
  const rating = calculatePlayerRating({ at_2v2: 1200, season_2v2: 1200, at_3v3: 1200, season_3v3: 1200 });
  assert.ok(Number.isFinite(rating) && rating > 0);
});

test("initialTeamRating of 3 equal ratings returns that rating exactly", () => {
  assert.ok(Math.abs(initialTeamRating([1500, 1500, 1500]) - 1500) < CLOSE);
});

test("initialTeamRating blend matches the spec's top-two/weakest split (~96.3445%/3.6555%)", () => {
  const strongest = 2000;
  const second = 1600;
  const weakest = 1000;
  const rating = initialTeamRating([strongest, second, weakest]);
  const topTwoPower = 0.7856990694999695;
  const weakestWeight = 0.03655501495514598;
  const topTwoCore = ((strongest ** topTwoPower + second ** topTwoPower) / 2) ** (1 / topTwoPower);
  const expected = (1 - weakestWeight) * topTwoCore + weakestWeight * weakest;
  assert.ok(Math.abs(rating - expected) < CLOSE);

  // The weakest player's marginal share of the blend is exactly weakestWeight (~3.6555%).
  const weakestShare = (rating - topTwoCore) / (weakest - topTwoCore);
  assert.ok(Math.abs(weakestShare - weakestWeight) < 1e-9, `expected weakest share ~3.6555%, got ${weakestShare * 100}%`);
});

test("initialTeamRating pads short rosters and truncates long ones", () => {
  const solo = initialTeamRating([1400]);
  assert.ok(Math.abs(solo - 1400) < CLOSE, "a single player padded with their own average should return their own rating");

  const four = initialTeamRating([1000, 1200, 1400, 1600]);
  const topThree = initialTeamRating([1200, 1400, 1600]);
  assert.ok(Math.abs(four - topThree) < CLOSE, "a 4th, weakest player should be dropped entirely");
});

test("predictSeries scoreline probabilities sum to 1 across several ratings and bestOf values", () => {
  const cases: [number, number, number][] = [
    [1500, 1500, 4], [1800, 1200, 4], [1200, 1800, 4],
    [1500, 1500, 3], [1650, 1450, 2], [2000, 1000, 1],
  ];
  for (const [ratingA, ratingB, winsNeeded] of cases) {
    const { scorelines } = predictSeries(ratingA, ratingB, winsNeeded, 643.3922991071429);
    const total = scorelines.reduce((s, sc) => s + sc.probability, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `scorelines for (${ratingA},${ratingB},bo${winsNeeded * 2 - 1}) summed to ${total}`);
  }
});

test("equal ratings predict an exact 50/50 series", () => {
  const { pASeries, pBSeries } = predictSeries(1500, 1500, 2, 643.3922991071429);
  assert.ok(Math.abs(pASeries - 0.5) < CLOSE);
  assert.ok(Math.abs(pBSeries - 0.5) < CLOSE);
});

test("gameWinProbability is symmetric and centered at 0.5 for equal ratings", () => {
  assert.ok(Math.abs(gameWinProbability(1500, 1500, 300) - 0.5) < CLOSE);
  const pA = gameWinProbability(1600, 1400, 300);
  const pB = gameWinProbability(1400, 1600, 300);
  assert.ok(Math.abs(pA + pB - 1) < CLOSE);
});

test("applyRatingUpdate is zero-sum", () => {
  const { newRatingA, newRatingB, deltaA } = applyRatingUpdate(1500, 1450, 4, 2, 4);
  assert.ok(Math.abs((newRatingA - 1500) + (newRatingB - 1450)) < CLOSE);
  assert.ok(Math.abs((newRatingA - 1500) - deltaA) < CLOSE);
});

test("applyRatingUpdate rewards an upset more than it rewards a favorite's expected win", () => {
  // Underdog (B, rated lower) sweeping the favorite is a bigger surprise than the
  // favorite winning as expected, so the underdog's series should gain more.
  const favorite = applyRatingUpdate(1700, 1300, 4, 0, 4); // favorite (A) wins as expected
  const upset = applyRatingUpdate(1300, 1700, 4, 0, 4); // underdog (A here) sweeps instead
  assert.ok(upset.deltaA > favorite.deltaA, "an underdog sweep should move rating more than a favorite's expected sweep");
});

test("applyFormRetention pulls the current rating back toward its initial rating", () => {
  const retained = applyFormRetention(1600, 1500);
  assert.ok(retained > 1500 && retained < 1600);
  assert.ok(Math.abs(applyFormRetention(1500, 1500) - 1500) < CLOSE, "a team already at its initial rating is unaffected");
});

// Section 18 of the spec ("Observed Dominance and Continuous Evaluation") is an
// evaluation/backtest-only metric, deliberately NOT implemented in rating.ts (its
// 0.8 retention only applies to a post-hoc pick-accuracy score, never to the live
// Section 19 rating update, which uses raw observed share instead). Reimplemented
// here, isolated, purely to pin the formula to the spec's worked examples.
function adjustObservedShare(rawObservedShare: number): number {
  return 0.5 + 0.8 * (rawObservedShare - 0.5);
}

test("AdjustObservedShare (Section 18, evaluation-only) matches the spec's worked examples", () => {
  const cases: [number, number][] = [
    [1.00, 0.90],
    [0.75, 0.70],
    [0.50, 0.50],
    [0.00, 0.10],
  ];
  for (const [raw, expected] of cases) {
    assert.ok(Math.abs(adjustObservedShare(raw) - expected) < CLOSE, `raw ${raw} should adjust to ${expected}`);
  }
});
