import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LINEUP_SLOTS,
  ROSTER_SIZE,
  ROSTER_TIER_LIMITS,
  chooseAutopick,
  managerIndexForPick,
  pickRound,
  poolShortfall,
  shuffled,
  slotForPick,
  slotTier,
  tierCounts,
  tierNeeded,
  totalDraftPicks,
  type DraftCandidate,
  type LineupSlot,
} from "../app/lib/fantasy-draft";
import type { FantasyTier } from "../app/lib/fantasy-pool";

test("the roster limits add up to the roster size and the slot list", () => {
  assert.equal(ROSTER_TIER_LIMITS[1] + ROSTER_TIER_LIMITS[2] + ROSTER_TIER_LIMITS[3], ROSTER_SIZE);
  assert.equal(LINEUP_SLOTS.length, ROSTER_SIZE);
  assert.equal(totalDraftPicks(5), 40);
});

test("snake order runs down then back up", () => {
  const order = Array.from({ length: 12 }, (_, p) => managerIndexForPick(p, 4));
  assert.deepEqual(order, [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
  assert.equal(pickRound(0, 4), 1);
  assert.equal(pickRound(4, 4), 2);
});

test("every manager gets exactly eight picks", () => {
  for (const n of [4, 5, 6]) {
    const counts = new Array(n).fill(0);
    for (let p = 0; p < totalDraftPicks(n); p++) counts[managerIndexForPick(p, n)] += 1;
    assert.deepEqual(counts, new Array(n).fill(ROSTER_SIZE));
  }
});

test("tier limits", () => {
  const counts = tierCounts([1, 1, 2, 3]);
  assert.equal(tierNeeded(counts, 1), false);
  assert.equal(tierNeeded(counts, 2), true);
  assert.equal(tierNeeded(counts, 3), true);
});

// Every order a manager could draft a legal 2/3/3 roster in.
function* tierOrders(remaining: Record<FantasyTier, number>, prefix: FantasyTier[] = []): Generator<FantasyTier[]> {
  if (prefix.length === ROSTER_SIZE) {
    yield prefix;
    return;
  }
  for (const t of [1, 2, 3] as FantasyTier[]) {
    if (remaining[t] === 0) continue;
    yield* tierOrders({ ...remaining, [t]: remaining[t] - 1 }, [...prefix, t]);
  }
}

test("any legal draft order fills a valid lineup", () => {
  let orders = 0;
  for (const order of tierOrders({ ...ROSTER_TIER_LIMITS })) {
    orders++;
    const filled = new Map<LineupSlot, FantasyTier>();
    for (const tier of order) {
      const slot = slotForPick(new Set(filled.keys()), tier);
      assert.ok(slot, `no slot for tier ${tier} in ${order.join("")}`);
      assert.ok(!filled.has(slot));
      const need = slotTier(slot);
      assert.ok(need === null || need === tier, `tier ${tier} put in ${slot}`);
      filled.set(slot, tier);
    }
    assert.equal(filled.size, ROSTER_SIZE);
  }
  assert.equal(orders, 560);
});

test("a tier's own slots fill before Flex", () => {
  assert.equal(slotForPick(new Set(), 1), "cap");
  assert.equal(slotForPick(new Set<LineupSlot>(["cap"]), 1), "flex");
  assert.equal(slotForPick(new Set<LineupSlot>(["cap", "flex"]), 1), "bench1");
  assert.equal(slotForPick(new Set<LineupSlot>(["first1"]), 2), "first2");
});

test("autopick takes the best needed tier, then rating", () => {
  const pool: DraftCandidate[] = [
    { id: "a", tier: 2, rating: 1900 },
    { id: "b", tier: 1, rating: 1600 },
    { id: "c", tier: 1, rating: 1700 },
    { id: "d", tier: 3, rating: 1500 },
  ];
  assert.equal(chooseAutopick(pool, tierCounts([]))?.id, "c");
  assert.equal(chooseAutopick(pool, tierCounts([1, 1]))?.id, "a");
  assert.equal(chooseAutopick(pool, tierCounts([1, 1, 2, 2, 2]))?.id, "d");
  assert.equal(chooseAutopick(pool, tierCounts([1, 1, 2, 2, 2, 3, 3, 3])), null);
});

test("pool shortfall names the tiers that can't fill", () => {
  assert.deepEqual(poolShortfall({ 1: 12, 2: 18, 3: 18 }, 6), []);
  assert.deepEqual(poolShortfall({ 1: 7, 2: 12, 3: 11 }, 4), [1, 3]);
});

test("shuffle keeps every item", () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = shuffled(["a", "b", "c", "d", "e"], random);
  assert.deepEqual([...out].sort(), ["a", "b", "c", "d", "e"]);
});
