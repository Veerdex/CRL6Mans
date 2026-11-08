import { test } from "node:test";
import assert from "node:assert/strict";

import {
  absorbMmrChange,
  adjustmentAfterMmrEdit,
  applySeriesResult,
  fantasyPoints,
  projectedFantasyPoints,
  FP_BASELINE_RV,
  SERIES_PLAYED_CAP,
} from "../app/lib/rv-adjustment";
import { mmrRatingFromRow, playerRatingFromRow } from "../app/lib/rating";

const close = (actual: number, expected: number, tol = 0.5) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);

// The 2026-11-07 test series the constants were tuned on: M3L0DY, 74 seeded games.
const M3L0DY_ROW = { peak_2v2: "1831", current_2v2: "1765", peak_3v3: "1835", current_3v3: "1651" };
const M3L0DY_HISTORY = { games: 74, goals: 59, assists: 38, saves: 99, shots: 196, score: 27859 };
const M3L0DY_SERIES = { score: 1819, goals: 6, assists: 4, saves: 6, shots: 8 };
const perGame = (s: typeof M3L0DY_SERIES, games: number) => ({
  score: s.score / games, goals: s.goals / games, assists: s.assists / games, saves: s.saves / games, shots: s.shots / games,
});

test("the projection line passes through the league mean at the baseline RV", () => {
  close(projectedFantasyPoints(FP_BASELINE_RV, null), 1.0177, 0.0005);
});

test("M3L0DY's pre-series projection under the refit score line", () => {
  close(projectedFantasyPoints(mmrRatingFromRow(M3L0DY_ROW), M3L0DY_HISTORY), 1.103, 0.001);
  close(fantasyPoints(perGame(M3L0DY_SERIES, 3)), 2.070, 0.001);
});

test("a first series 0.977 FP over prediction across 3 games moves RV by about +100", () => {
  const r = applySeriesResult({ adjustment: 0, seriesPlayed: 0 }, 1.093, 2.070, 3);
  close(r.delta, 100.7);
  assert.equal(r.seriesPlayed, 1);
});

test("an established player's series carries 1/7 weight and the counter stays capped", () => {
  const r = applySeriesResult({ adjustment: 0, seriesPlayed: SERIES_PLAYED_CAP }, 1.093, 2.070, 3);
  close(r.delta, 28.8);
  assert.equal(r.seriesPlayed, SERIES_PLAYED_CAP);
});

test("a series the player sat out changes nothing", () => {
  const r = applySeriesResult({ adjustment: 12, seriesPlayed: 2 }, 1, 2, 0);
  assert.deepEqual(r, { adjustment: 12, seriesPlayed: 2, delta: 0 });
});

const shown = (adj: number, from: number, to: number) => to + absorbMmrChange(adj, from, to) - (from + adj);

test("with no adjustment an MMR move passes through 1:1", () => {
  assert.equal(shown(0, 1500, 1600), 100);
  assert.equal(shown(0, 1500, 1400), -100);
});

test("a rise toward the adjusted rating passes through less the bigger the gap", () => {
  close(shown(20, 1500, 1600), 87.8, 0.05);
  close(shown(100, 1500, 1600), 49.0, 0.05);
  close(shown(500, 1500, 1600), 1.2, 0.05);
  close(shown(-100, 1600, 1500), -49.0, 0.05);
});

test("one edit and the same edit in two steps land in the same place", () => {
  const twoSteps = absorbMmrChange(absorbMmrChange(100, 1500, 1550), 1550, 1600);
  close(twoSteps, absorbMmrChange(100, 1500, 1600), 1e-9);
});

test("the adjustment shrinks toward zero without crossing it", () => {
  const left = absorbMmrChange(70, 1753, 2753);
  assert.ok(left > 0 && left < 0.01);
});

test("an MMR move away from the adjusted rating passes through 1:1", () => {
  assert.equal(absorbMmrChange(70, 1753, 1720), 70);
  assert.equal(absorbMmrChange(-40, 1753, 1800), -40);
});

test("re-saving the same MMR changes nothing", () => {
  assert.equal(absorbMmrChange(-40, 1753, 1753), -40);
});

test("the displayed rating is MMR rating plus the adjustment", () => {
  const base = mmrRatingFromRow(M3L0DY_ROW);
  close(playerRatingFromRow({ ...M3L0DY_ROW, rv_adjustment: 100 }), base + 100, 1e-9);
  close(playerRatingFromRow({ ...M3L0DY_ROW, rv_adjustment: null }), base, 1e-9);
  close(playerRatingFromRow(M3L0DY_ROW), base, 1e-9);
});

test("an MMR edit is measured on the MMR rating, not the adjusted one", () => {
  const before = { ...M3L0DY_ROW, rv_adjustment: 100 };
  const raised = { ...M3L0DY_ROW, peak_3v3: "1935", current_3v3: "1751" };
  const rise = mmrRatingFromRow(raised) - mmrRatingFromRow(M3L0DY_ROW);
  assert.ok(rise > 0 && rise < 100);
  close(adjustmentAfterMmrEdit(before, raised), absorbMmrChange(100, 0, rise), 1e-9);
  assert.equal(adjustmentAfterMmrEdit(before, M3L0DY_ROW), 100);
});

test("games with no recorded score are left out of the score history only", () => {
  const scoreless = { ...M3L0DY_HISTORY, games: M3L0DY_HISTORY.games + 20 };
  const rv = mmrRatingFromRow(M3L0DY_ROW);
  const withScoreGames = projectedFantasyPoints(rv, { ...scoreless, scoreGames: M3L0DY_HISTORY.games });
  const naive = projectedFantasyPoints(rv, scoreless);
  assert.ok(withScoreGames > naive);
});

test("a first MMR entry over the all-zero default keeps the adjustment", () => {
  const unset = { peak_2v2: "0", current_2v2: "0", peak_3v3: "0", current_3v3: "0", rv_adjustment: 16.6 };
  assert.equal(adjustmentAfterMmrEdit(unset, M3L0DY_ROW), 16.6);
});

const UNSET = { peak_2v2: "0", current_2v2: "0", peak_3v3: "0", current_3v3: "0" };

test("a first entry is measured against the rating a seeded adjustment was earned at", () => {
  const now = mmrRatingFromRow(M3L0DY_ROW);
  const climbed = { ...UNSET, rv_adjustment: 100, rv_adjustment_basis: now - 100 };
  close(adjustmentAfterMmrEdit(climbed, M3L0DY_ROW), absorbMmrChange(100, now - 100, now), 1e-9);
  assert.ok(adjustmentAfterMmrEdit(climbed, M3L0DY_ROW) < 100);
  const fell = { ...UNSET, rv_adjustment: 100, rv_adjustment_basis: now + 100 };
  assert.equal(adjustmentAfterMmrEdit(fell, M3L0DY_ROW), 100);
});

test("an entry that still leaves no MMR on file keeps the basis untouched", () => {
  const seeded = { ...UNSET, rv_adjustment: 100, rv_adjustment_basis: 1500 };
  assert.equal(adjustmentAfterMmrEdit(seeded, UNSET), 100);
});
