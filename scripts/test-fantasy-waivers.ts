// Run with: npm run test:fantasy-waivers

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  latestWaiverRun,
  moveToBack,
  nextWaiverRun,
  playerStatus,
  settleClaims,
  swapInProblem,
  waiverClearsAt,
  waiverOrder,
  type PendingClaim,
} from "../app/lib/fantasy-waivers";
import type { FantasyTier } from "../app/lib/fantasy-pool";

const at = (iso: string) => new Date(iso);

test("the run is 4 AM Pacific: 11:00 UTC in daylight time, 12:00 UTC in standard", () => {
  assert.equal(latestWaiverRun(at("2026-07-15T18:00:00Z")).toISOString(), "2026-07-15T11:00:00.000Z");
  assert.equal(latestWaiverRun(at("2026-12-15T18:00:00Z")).toISOString(), "2026-12-15T12:00:00.000Z");
});

test("before today's run, the latest run is yesterday's", () => {
  assert.equal(latestWaiverRun(at("2026-07-15T10:59:00Z")).toISOString(), "2026-07-14T11:00:00.000Z");
  assert.equal(latestWaiverRun(at("2026-07-15T11:00:00Z")).toISOString(), "2026-07-15T11:00:00.000Z");
});

test("the next run is the first at or after the instant", () => {
  assert.equal(nextWaiverRun(at("2026-07-15T11:00:00Z")).toISOString(), "2026-07-15T11:00:00.000Z");
  assert.equal(nextWaiverRun(at("2026-07-15T11:00:01Z")).toISOString(), "2026-07-16T11:00:00.000Z");
});

test("the runs either side of each daylight saving change stay at 4 AM local", () => {
  // 2026-03-08 springs forward, 2026-11-01 falls back, both at 2 AM.
  assert.equal(nextWaiverRun(at("2026-03-07T13:00:00Z")).toISOString(), "2026-03-08T11:00:00.000Z");
  assert.equal(latestWaiverRun(at("2026-03-08T10:30:00Z")).toISOString(), "2026-03-07T12:00:00.000Z");
  assert.equal(nextWaiverRun(at("2026-10-31T12:00:00Z")).toISOString(), "2026-11-01T12:00:00.000Z");
  assert.equal(latestWaiverRun(at("2026-11-01T11:30:00Z")).toISOString(), "2026-10-31T11:00:00.000Z");
});

test("a player clears in the first run once his 24 hours are up", () => {
  // Reported Wednesday 9 PM Pacific: 24h runs to Thursday 9 PM, so Friday 4 AM.
  assert.equal(waiverClearsAt(at("2026-07-16T04:00:00Z")).toISOString(), "2026-07-17T11:00:00.000Z");
  // Reported at 3 AM: 24h ends at 3 AM the next day, an hour before that day's run.
  assert.equal(waiverClearsAt(at("2026-07-15T10:00:00Z")).toISOString(), "2026-07-16T11:00:00.000Z");
});

test("waiver order starts as the reverse of the draft order", () => {
  assert.deepEqual(waiverOrder(null, ["a", "b", "c"], ["a", "b", "c"]), ["c", "b", "a"]);
  assert.deepEqual(waiverOrder(["b", "a", "c"], ["a", "b", "c"], ["a", "b", "c"]), ["b", "a", "c"]);
});

test("waiver order drops managers who left and puts unlisted members last", () => {
  assert.deepEqual(waiverOrder(["b", "a", "c"], null, ["a", "c", "d"]), ["a", "c", "d"]);
});

test("a successful claim sends the manager to the back", () => {
  assert.deepEqual(moveToBack(["a", "b", "c", "d"], "b"), ["a", "c", "d", "b"]);
});

test("status: rostered, then waivers until they clear, then a free agent", () => {
  const now = at("2026-07-15T12:00:00Z");
  assert.deepEqual(playerStatus(true, "2026-07-16T11:00:00Z", now), { kind: "rostered" });
  assert.deepEqual(playerStatus(false, "2026-07-16T11:00:00Z", now), { kind: "waivers", clearsAt: "2026-07-16T11:00:00Z" });
  assert.deepEqual(playerStatus(false, "2026-07-15T11:00:00Z", now), { kind: "free_agent" });
  assert.deepEqual(playerStatus(false, null, now), { kind: "free_agent" });
});

test("a move is like for like, and neither player may be mid-match", () => {
  const add = { tier: 2 as FantasyTier, locked: false };
  assert.equal(swapInProblem(add, { tier: 2, locked: false, onRoster: true }), null);
  assert.match(swapInProblem(add, { tier: 3, locked: false, onRoster: true })!, /Tier 2/);
  assert.match(swapInProblem(add, { tier: 2, locked: true, onRoster: true })!, /dropped/);
  assert.match(swapInProblem({ tier: 2, locked: true }, { tier: 2, locked: false, onRoster: true })!, /started/);
  assert.match(swapInProblem(add, { tier: 2, locked: false, onRoster: false })!, /roster/);
  assert.match(swapInProblem(add, null)!, /roster/);
});

const tiers: Record<string, FantasyTier> = { x: 2, y: 2, z: 3, a2: 2, b2: 2, c2: 2, b3: 3 };
const claim = (id: string, managerId: string, playerId: string, dropPlayerId: string, createdAt = "2026-07-15T00:00:00Z"): PendingClaim => ({
  id, managerId, playerId, dropPlayerId, createdAt,
});
const base = () => ({
  order: ["a", "b", "c"],
  rosters: new Map([
    ["a", new Set(["a2"])],
    ["b", new Set(["b2", "b3"])],
    ["c", new Set(["c2"])],
  ]),
  tierOf: (id: string) => tiers[id],
  locked: new Set<string>(),
});

test("the highest priority claim wins and that manager goes to the back", () => {
  const r = settleClaims({ ...base(), due: ["x"], claims: [claim("1", "b", "x", "b2"), claim("2", "a", "x", "a2")] });
  assert.deepEqual(r.awards.map((c) => c.id), ["2"]);
  assert.deepEqual(r.outcomes, [
    { id: "2", status: "won", note: null },
    { id: "1", status: "lost", note: null },
  ]);
  assert.deepEqual(r.order, ["b", "c", "a"]);
  assert.deepEqual(r.cleared, ["x"]);
});

test("a winner's new priority applies to the next player in the same run", () => {
  const r = settleClaims({
    ...base(),
    due: ["x", "y"],
    claims: [claim("1", "a", "x", "a2"), claim("2", "b", "x", "b2"), claim("3", "a", "y", "a2"), claim("4", "b", "y", "b2")],
  });
  // a won x and went to the back, so b outranks a for y.
  assert.deepEqual(r.awards.map((c) => c.id), ["1", "4"]);
  assert.equal(r.outcomes.find((o) => o.id === "3")!.status, "lost");
  assert.deepEqual(r.order, ["c", "a", "b"]);
});

test("a claim whose drop went in an earlier award of the same run fails", () => {
  const r = settleClaims({ ...base(), due: ["x", "y"], claims: [claim("1", "a", "x", "a2"), claim("2", "a", "y", "a2")] });
  assert.deepEqual(r.awards.map((c) => c.id), ["1"]);
  assert.equal(r.outcomes[1].status, "failed");
  assert.match(r.outcomes[1].note!, /already left/);
});

test("a claim that can't go through falls to the next manager", () => {
  const r = settleClaims({ ...base(), due: ["x"], claims: [claim("1", "a", "x", "a2"), claim("2", "b", "x", "b2")], locked: new Set(["a2"]) });
  assert.deepEqual(r.awards.map((c) => c.id), ["2"]);
  assert.equal(r.outcomes[0].status, "failed");
  assert.match(r.outcomes[0].note!, /dropped/);
});

test("a wrong-tier drop fails", () => {
  const r = settleClaims({ ...base(), due: ["z"], claims: [claim("1", "a", "z", "a2"), claim("2", "b", "z", "b3")] });
  assert.deepEqual(r.awards.map((c) => c.id), ["2"]);
  assert.equal(r.outcomes[0].status, "failed");
});

test("a manager no longer in the order can't win", () => {
  const r = settleClaims({ ...base(), order: ["b", "c"], due: ["x"], claims: [claim("1", "a", "x", "a2"), claim("2", "b", "x", "b2")] });
  assert.deepEqual(r.awards.map((c) => c.id), ["2"]);
});

test("a player mid-match at the run waits for the next one with his claims pending", () => {
  const r = settleClaims({ ...base(), due: ["x"], claims: [claim("1", "a", "x", "a2")], locked: new Set(["x"]) });
  assert.deepEqual(r.outcomes, []);
  assert.deepEqual(r.cleared, []);
  assert.deepEqual(r.order, ["a", "b", "c"]);
});

test("a player nobody claims just clears", () => {
  const r = settleClaims({ ...base(), due: ["y"], claims: [] });
  assert.deepEqual(r.cleared, ["y"]);
  assert.deepEqual(r.awards, []);
});
