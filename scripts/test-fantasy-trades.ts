// Run with: npm run test:fantasy-trades

import { test } from "node:test";
import assert from "node:assert/strict";

import { reviewOutcome, tallyVotes, tradeMoves, tradeShapeProblem } from "../app/lib/fantasy-trades";
import type { LineupEntry } from "../app/lib/fantasy-lineup";

const t = (tier: 1 | 2 | 3) => ({ tier });

test("a trade needs a player on each side", () => {
  assert.match(tradeShapeProblem([], [t(2)])!, /at least one/);
  assert.match(tradeShapeProblem([t(2)], [])!, /at least one/);
});

test("each side gives up the tiers it gets back, in any order", () => {
  assert.equal(tradeShapeProblem([t(2)], [t(2)]), null);
  assert.equal(tradeShapeProblem([t(1), t(3)], [t(3), t(1)]), null);
  assert.match(tradeShapeProblem([t(2)], [t(3)])!, /give 1 1st and get 0/);
  assert.match(tradeShapeProblem([t(1), t(1)], [t(1)])!, /give 2 Cap and get 1/);
});

const lineup = (prefix: string): LineupEntry[] => [
  { slot: "cap", playerId: `${prefix}-cap`, tier: 1, locked: false },
  { slot: "first1", playerId: `${prefix}-1a`, tier: 2, locked: false },
  { slot: "first2", playerId: `${prefix}-1b`, tier: 2, locked: false },
  { slot: "second1", playerId: `${prefix}-2a`, tier: 3, locked: false },
  { slot: "second2", playerId: `${prefix}-2b`, tier: 3, locked: false },
  { slot: "flex", playerId: `${prefix}-flex`, tier: 1, locked: false },
  { slot: "bench1", playerId: `${prefix}-1c`, tier: 2, locked: false },
  { slot: "bench2", playerId: `${prefix}-2c`, tier: 3, locked: false },
];

test("each incoming player takes the slot of an outgoing player of his tier", () => {
  const moves = tradeMoves(
    { managerId: "a", lineup: lineup("a"), out: ["a-1c"] },
    { managerId: "b", lineup: lineup("b"), out: ["b-1a"] },
  );
  assert.deepEqual(moves, [
    { playerId: "a-1c", fromManagerId: "a", fromSlot: "bench1", toManagerId: "b", toSlot: "first1" },
    { playerId: "b-1a", fromManagerId: "b", fromSlot: "first1", toManagerId: "a", toSlot: "bench1" },
  ]);
});

test("a Cap in the flex slot is traded for a Cap who takes the flex slot", () => {
  const moves = tradeMoves(
    { managerId: "a", lineup: lineup("a"), out: ["a-flex", "a-2b"] },
    { managerId: "b", lineup: lineup("b"), out: ["b-2c", "b-cap"] },
  );
  assert.ok(Array.isArray(moves));
  const landing = new Map(moves.map((m) => [m.playerId, `${m.toManagerId}:${m.toSlot}`]));
  assert.equal(landing.get("b-cap"), "a:flex");
  assert.equal(landing.get("a-flex"), "b:cap");
  assert.equal(landing.get("b-2c"), "a:second2");
  assert.equal(landing.get("a-2b"), "b:bench2");
});

test("every slot a trade empties is filled again, so both rosters stay whole", () => {
  const moves = tradeMoves(
    { managerId: "a", lineup: lineup("a"), out: ["a-cap", "a-1a", "a-2c"] },
    { managerId: "b", lineup: lineup("b"), out: ["b-2a", "b-flex", "b-1c"] },
  );
  assert.ok(Array.isArray(moves));
  const key = (m: string, s: string) => `${m}:${s}`;
  const emptied = moves.map((m) => key(m.fromManagerId, m.fromSlot)).sort();
  const filled = moves.map((m) => key(m.toManagerId, m.toSlot)).sort();
  assert.deepEqual(filled, emptied);
});

test("a player who has left his roster since the proposal makes the trade stale", () => {
  const moves = tradeMoves(
    { managerId: "a", lineup: lineup("a"), out: ["gone"] },
    { managerId: "b", lineup: lineup("b"), out: ["b-1a"] },
  );
  assert.equal(typeof moves, "string");
});

test("acceptance re-checks the shape against the current lineups", () => {
  const moves = tradeMoves(
    { managerId: "a", lineup: lineup("a"), out: ["a-1a"] },
    { managerId: "b", lineup: lineup("b"), out: ["b-2a"] },
  );
  assert.match(moves as string, /like for like/);
});

const tally = (accepts: number, rejects: number, eligible: number) => ({ accepts, rejects, eligible });
const ends = new Date("2026-11-10T00:00:00Z");
const before = new Date("2026-11-09T12:00:00Z");
const after = new Date("2026-11-10T00:00:01Z");

test("a trade with nobody to review it goes straight through", () => {
  assert.equal(reviewOutcome(tally(0, 0, 0), ends, before), "execute");
});

test("half or more of the league rejecting declines a trade", () => {
  assert.equal(reviewOutcome(tally(0, 1, 1), ends, before), "veto");
  assert.equal(reviewOutcome(tally(0, 1, 2), ends, before), "veto");
  assert.equal(reviewOutcome(tally(1, 1, 3), ends, before), "wait");
  assert.equal(reviewOutcome(tally(0, 2, 3), ends, before), "veto");
  assert.equal(reviewOutcome(tally(0, 2, 4), ends, after), "veto");
});

test("more than half accepting puts a trade through early", () => {
  assert.equal(reviewOutcome(tally(1, 0, 1), ends, before), "execute");
  assert.equal(reviewOutcome(tally(1, 0, 2), ends, before), "wait");
  assert.equal(reviewOutcome(tally(2, 0, 3), ends, before), "execute");
  assert.equal(reviewOutcome(tally(2, 1, 4), ends, before), "wait");
  assert.equal(reviewOutcome(tally(3, 1, 4), ends, before), "execute");
});

test("a trade the league hasn't declined goes through when the window ends", () => {
  assert.equal(reviewOutcome(tally(0, 0, 3), ends, before), "wait");
  assert.equal(reviewOutcome(tally(0, 0, 3), ends, after), "execute");
  assert.equal(reviewOutcome(tally(0, 1, 3), ends, after), "execute");
});

test("only managers still eligible to vote are counted", () => {
  const votes = [
    { accountId: "c", vote: "reject" as const },
    { accountId: "d", vote: "accept" as const },
    { accountId: "gone", vote: "reject" as const },
  ];
  assert.deepEqual(tallyVotes(votes, new Set(["c", "d", "e"])), tally(1, 1, 3));
});
