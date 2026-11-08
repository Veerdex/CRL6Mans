// Run with: npm run test:fantasy-lineup

import { test } from "node:test";
import assert from "node:assert/strict";

import { LINEUP_SLOTS } from "../app/lib/fantasy-draft";
import { lockedTeams, moveTargets, slotAccepts, swapProblem, type LineupEntry } from "../app/lib/fantasy-lineup";

// The lineup the draft leaves: each tier's own slots, then its extra in Flex or the bench.
const drafted = (): LineupEntry[] => [
  { slot: "cap", playerId: "t1a", tier: 1, locked: false },
  { slot: "first1", playerId: "t2a", tier: 2, locked: false },
  { slot: "first2", playerId: "t2b", tier: 2, locked: false },
  { slot: "second1", playerId: "t3a", tier: 3, locked: false },
  { slot: "second2", playerId: "t3b", tier: 3, locked: false },
  { slot: "flex", playerId: "t1b", tier: 1, locked: false },
  { slot: "bench1", playerId: "t2c", tier: 2, locked: false },
  { slot: "bench2", playerId: "t3c", tier: 3, locked: false },
];

test("tiered slots take only their tier; Flex and the bench take anyone", () => {
  assert.ok(slotAccepts("cap", 1));
  assert.ok(!slotAccepts("cap", 2));
  assert.ok(slotAccepts("second2", 3));
  for (const tier of [1, 2, 3] as const) {
    assert.ok(slotAccepts("flex", tier));
    assert.ok(slotAccepts("bench1", tier));
  }
});

test("a benched player can swap with a same-tier starter or with Flex", () => {
  assert.deepEqual(moveTargets(drafted(), "bench1", LINEUP_SLOTS), ["first1", "first2", "flex", "bench2"]);
});

test("a swap must leave both players somewhere that takes them", () => {
  // Flex holds a Tier 1, so a Tier 3 from the bench can go to Flex only if
  // the Tier 1 fits on the bench, which it does.
  assert.equal(swapProblem(drafted(), "bench2", "flex"), null);
  // The captain can't go to a 1st slot, and a 1st can't come back to Cap.
  assert.match(swapProblem(drafted(), "cap", "first1")!, /Tier 1/);
  // Flex's Tier 1 can move to Cap, since the Cap goes back to Flex.
  assert.equal(swapProblem(drafted(), "flex", "cap"), null);
  assert.notEqual(swapProblem(drafted(), "cap", "cap"), null);
});

test("a locked player can't move, and nobody can swap into their slot", () => {
  const lineup = drafted().map((e) => (e.slot === "first1" ? { ...e, locked: true } : e));
  assert.deepEqual(moveTargets(lineup, "first1", LINEUP_SLOTS), []);
  assert.ok(!moveTargets(lineup, "bench1", LINEUP_SLOTS).includes("first1"));
  assert.match(swapProblem(lineup, "bench1", "first1")!, /started/);
});

test("a move onto an empty slot only checks the mover", () => {
  const lineup = drafted().filter((e) => e.slot !== "bench2");
  assert.equal(swapProblem(lineup, "second1", "bench2"), null);
  assert.notEqual(swapProblem(lineup, "bench2", "flex"), null, "nobody to move");
});

test("a team is locked from its scheduled start until the series is reported", () => {
  const now = new Date("2026-11-10T20:00:00Z");
  const m = (over: Partial<Parameters<typeof lockedTeams>[0][number]>) => ({
    home_team_id: "h", away_team_id: "a", status: "scheduled", scheduled_at: "2026-11-10T19:00:00Z", ...over,
  });

  assert.deepEqual([...lockedTeams([m({})], now)].sort(), ["a", "h"]);
  assert.equal(lockedTeams([m({ status: "pending" })], now).size, 2, "a submitted score isn't reported yet");
  assert.equal(lockedTeams([m({ status: "completed" })], now).size, 0);
  assert.equal(lockedTeams([m({ status: "cancelled" })], now).size, 0);
  assert.equal(lockedTeams([m({ scheduled_at: "2026-11-10T21:00:00Z" })], now).size, 0, "not started yet");
  assert.equal(lockedTeams([m({ scheduled_at: null })], now).size, 0, "no time set, no lock window");
  assert.equal(lockedTeams([m({ away_team_id: null })], now).size, 0, "an unseated bracket slot locks nobody");
});
