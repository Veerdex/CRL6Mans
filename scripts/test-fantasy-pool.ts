import { test } from "node:test";
import assert from "node:assert/strict";

import {
  expectedWinBonus,
  freeAgentTier,
  matchupMultiplier,
  projectedSeriesPoints,
  projectedStatPoints,
  projectionBasis,
  seriesFantasyPoints,
  seriesWinChance,
  tierFromDraftRound,
} from "../app/lib/fantasy-pool";
import { FP_BASELINE_RV, fantasyPoints, projectedFantasyPoints } from "../app/lib/rv-adjustment";

const close = (actual: number, expected: number, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);

const ZERO = { score: 0, goals: 0, assists: 0, saves: 0, shots: 0 };

test("draft rounds map onto tiers", () => {
  assert.equal(tierFromDraftRound(0), 1);
  assert.equal(tierFromDraftRound(1), 2);
  assert.equal(tierFromDraftRound(2), 3);
  assert.equal(tierFromDraftRound(3), 3);
});

test("free agents split into season-wide thirds", () => {
  const season = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800];
  assert.equal(freeAgentTier(1800, season), 1);
  assert.equal(freeAgentTier(1600, season), 1);
  assert.equal(freeAgentTier(1500, season), 2);
  assert.equal(freeAgentTier(1300, season), 2);
  assert.equal(freeAgentTier(1200, season), 3);
  assert.equal(freeAgentTier(1000, season), 3);
});

test("tied ratings share a tier", () => {
  assert.equal(freeAgentTier(1500, [1500, 1500, 1500]), 1);
});

test("projection basis follows the history weight", () => {
  assert.equal(projectionBasis(0), "rating");
  assert.equal(projectionBasis(9), "provisional");
  assert.equal(projectionBasis(10), "history");
});

test("projection with ranks on file is 20 × the rv-adjustment projection", () => {
  const history = { games: 20, goals: 20, assists: 10, saves: 30, shots: 50, score: 8000 };
  close(projectedStatPoints(1800, history), 20 * projectedFantasyPoints(1800, history));
  close(projectedStatPoints(1800, null), 20 * projectedFantasyPoints(1800, null));
});

test("no ranks and no history projects the league mean", () => {
  close(projectedStatPoints(null, null), 20 * projectedFantasyPoints(FP_BASELINE_RV, null));
});

test("no ranks with history projects the history alone", () => {
  const history = { games: 4, goals: 4, assists: 4, saves: 4, shots: 8, score: 1600 };
  close(projectedStatPoints(null, history), 20 * fantasyPoints({ score: 400, goals: 1, assists: 1, saves: 1, shots: 2 }));
});

test("an even best-of-5 adds the docs' 0.94 expected bonus and leaves stats alone", () => {
  close(expectedWinBonus({ ownRating: 1700, oppRating: 1700, winsNeeded: 3 }), 0.9375);
  const even = projectedSeriesPoints(1800, null, { ownRating: 1700, oppRating: 1700, winsNeeded: 3 });
  close(even, projectedStatPoints(1800, null) + 0.9375);
});

test("the same player projects lower against a stronger team", () => {
  const vsStrong = projectedSeriesPoints(1800, null, { ownRating: 1800, oppRating: 2000, winsNeeded: 3 });
  const vsWeak = projectedSeriesPoints(1800, null, { ownRating: 1800, oppRating: 1500, winsNeeded: 3 });
  assert.ok(vsStrong < vsWeak, `${vsStrong} should be below ${vsWeak}`);
});

test("the matchup multiplier runs 0.1 at a certain loss, 1 at an even series, 1.5 at a certain win", () => {
  close(matchupMultiplier(0), 0.1);
  close(matchupMultiplier(0.25), 1 - 0.9 * 0.5 ** 1.75);
  close(matchupMultiplier(0.5), 1);
  close(matchupMultiplier(0.75), 1.15, 0.005);
  close(matchupMultiplier(1), 1.5);
  close(matchupMultiplier(-1), 0.1);
  close(matchupMultiplier(2), 1.5);
});

test("projected stat points scale by the series win chance; the win bonus doesn't", () => {
  const matchup = { ownRating: 1944, oppRating: 1644, winsNeeded: 3 };
  const p = seriesWinChance(matchup);
  close(
    projectedSeriesPoints(1800, null, matchup),
    projectedStatPoints(1800, null) * matchupMultiplier(p) + expectedWinBonus(matchup),
  );
});

test("a 3-1 win played in full: stats over 4 games plus the 2-game bonus", () => {
  const stats = { score: 1600, goals: 4, assists: 4, saves: 4, shots: 8 };
  const pts = seriesFantasyPoints({ forfeit: false, ownScore: 3, oppScore: 1, stats, gamesPlayed: 4 });
  close(pts, 20 * fantasyPoints({ score: 400, goals: 1, assists: 1, saves: 1, shots: 2 }) + 2);
});

test("the bonus is prorated by games played, and a loss earns none", () => {
  const win = seriesFantasyPoints({ forfeit: false, ownScore: 3, oppScore: 0, stats: ZERO, gamesPlayed: 1 });
  close(win, 1);
  const loss = seriesFantasyPoints({ forfeit: false, ownScore: 1, oppScore: 3, stats: ZERO, gamesPlayed: 4 });
  close(loss, 0);
});

test("a forfeit or a series not played scores nothing", () => {
  const stats = { score: 1000, goals: 3, assists: 0, saves: 0, shots: 3 };
  assert.equal(seriesFantasyPoints({ forfeit: true, ownScore: 3, oppScore: 0, stats, gamesPlayed: 3 }), 0);
  assert.equal(seriesFantasyPoints({ forfeit: false, ownScore: 3, oppScore: 0, stats: ZERO, gamesPlayed: 0 }), 0);
});
