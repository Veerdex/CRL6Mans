import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeSeriesStats, gameWinners } from "../app/lib/fake-series-stats";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const HOME = ["h1", "h2", "h3"];
const AWAY = ["a1", "a2", "a3"];

test("the series winner takes the last game, and the game count matches the score", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const homeScore = seed % 4;
    const awayScore = 4;
    const order = gameWinners(homeScore, awayScore, seeded(seed));
    assert.equal(order.length, homeScore + awayScore);
    assert.equal(order.at(-1), "away");
    assert.equal(order.filter((w) => w === "home").length, homeScore);
  }
});

test("a tied or unplayed score yields no games", () => {
  assert.deepEqual(gameWinners(0, 0), []);
  assert.deepEqual(fakeSeriesStats({ home: HOME, away: AWAY, homeScore: 2, awayScore: 2 }), []);
});

test("every game is internally consistent", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rand = seeded(seed);
    const homeScore = 3;
    const awayScore = seed % 3;
    const lines = fakeSeriesStats({ home: HOME, away: AWAY, homeScore, awayScore }, rand);
    const order = gameWinners(homeScore, awayScore, seeded(seed));
    assert.equal(new Set(lines.map((l) => l.gameNumber)).size, homeScore + awayScore);
    assert.equal(order.length, homeScore + awayScore);

    for (let g = 1; g <= homeScore + awayScore; g++) {
      const game = lines.filter((l) => l.gameNumber === g);
      assert.equal(game.length, 6);
      const side = (ids: string[]) => game.filter((l) => ids.includes(l.playerId));
      const sum = (ls: typeof game, k: "goals" | "assists" | "saves" | "shots" | "demos" | "demoed") =>
        ls.reduce((n, l) => n + l[k], 0);
      const h = side(HOME);
      const a = side(AWAY);
      assert.notEqual(sum(h, "goals"), sum(a, "goals"), "no game ends level");
      for (const [mine, theirs] of [[h, a], [a, h]]) {
        assert.ok(sum(mine, "assists") <= sum(mine, "goals"));
        assert.ok(sum(mine, "saves") <= sum(theirs, "shots") - sum(theirs, "goals"));
        assert.equal(sum(mine, "demos"), sum(theirs, "demoed"));
      }
      for (const l of game) {
        assert.ok(l.shots >= l.goals);
        assert.ok(l.score >= 100 * l.goals + 50 * l.assists + 50 * l.saves + 10 * l.shots);
      }
    }
  }
});

test("the series winner wins the most games", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const lines = fakeSeriesStats({ home: HOME, away: AWAY, homeScore: 1, awayScore: 3 }, seeded(seed));
    let homeGames = 0;
    let awayGames = 0;
    for (let g = 1; g <= 4; g++) {
      const goals = (ids: string[]) =>
        lines.filter((l) => l.gameNumber === g && ids.includes(l.playerId)).reduce((n, l) => n + l.goals, 0);
      if (goals(HOME) > goals(AWAY)) homeGames++;
      else awayGames++;
    }
    assert.equal(homeGames, 1);
    assert.equal(awayGames, 3);
  }
});

test("a 1v1 never assists itself", () => {
  const lines = fakeSeriesStats({ home: ["h"], away: ["a"], homeScore: 3, awayScore: 0 }, seeded(7));
  assert.ok(lines.every((l) => l.assists === 0));
});

test("an empty roster yields nothing", () => {
  assert.deepEqual(fakeSeriesStats({ home: [], away: AWAY, homeScore: 3, awayScore: 0 }), []);
});
