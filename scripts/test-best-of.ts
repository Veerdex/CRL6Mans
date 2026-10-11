import test from "node:test";
import assert from "node:assert/strict";
import { DE_WINNERS, DE_LOSERS, DE_GF } from "@/app/lib/bracket";
import {
  computeStageSchedule,
  defaultRoundBestOfForPreset,
  normalizeRoundBestOf,
  resolveBestOf,
  STAGE_SLOTS_BY_PRESET,
  bestOfBlocks,
  type BestOf,
  type RoundBestOfConfig,
} from "@/app/dashboard/season/format-constants";

const tiers = (standard: BestOf, quarterfinals: BestOf, semifinals: BestOf, finals: BestOf) =>
  ({ mode: "tiered", tiers: { standard, quarterfinals, semifinals, finals } }) as const;

// An 8-team DE bracket: WB rounds 1-3, LB rounds 1-4, GF round 1.
const maxRounds = { [DE_WINNERS]: 3, [DE_LOSERS]: 4, [DE_GF]: 1 };

test("a config saved before the split still resolves to the values it was saved with", () => {
  const legacy: RoundBestOfConfig = { double_elimination: tiers(1, 5, 5, 7) };

  // Both brackets read the one block the admin configured — not the BO3 fallback.
  assert.equal(resolveBestOf(DE_WINNERS, 1, maxRounds, legacy), 5); // QF tier of 3 WB rounds
  assert.equal(resolveBestOf(DE_WINNERS, 3, maxRounds, legacy), 7);
  assert.equal(resolveBestOf(DE_LOSERS, 1, maxRounds, legacy), 1); // standard tier of 4 LB rounds
  assert.equal(resolveBestOf(DE_LOSERS, 4, maxRounds, legacy), 7);
  assert.equal(resolveBestOf(DE_GF, 1, maxRounds, legacy), 7);
});

test("normalizeRoundBestOf is idempotent and leaves a split config alone", () => {
  const legacy: RoundBestOfConfig = { double_elimination: tiers(1, 5, 5, 7) };
  const once = normalizeRoundBestOf(legacy);
  assert.deepEqual(normalizeRoundBestOf(once), once);

  const split: RoundBestOfConfig = {
    double_elimination: tiers(1, 1, 1, 1),
    de_winners: tiers(3, 3, 5, 7),
    de_losers: tiers(1, 1, 3, 5),
  };
  assert.deepEqual(normalizeRoundBestOf(split), split);
  assert.deepEqual(normalizeRoundBestOf(undefined), {});
});

test("the two brackets resolve independently once split", () => {
  const split: RoundBestOfConfig = {
    de_winners: tiers(3, 3, 5, 7),
    de_losers: tiers(1, 1, 1, 3),
  };
  assert.equal(resolveBestOf(DE_WINNERS, 1, maxRounds, split), 3);
  assert.equal(resolveBestOf(DE_WINNERS, 2, maxRounds, split), 5);
  assert.equal(resolveBestOf(DE_WINNERS, 3, maxRounds, split), 7);
  assert.equal(resolveBestOf(DE_LOSERS, 3, maxRounds, split), 1);
  assert.equal(resolveBestOf(DE_LOSERS, 4, maxRounds, split), 3);

  // The grand final answers to the winners block's finals tier.
  assert.equal(resolveBestOf(DE_GF, 1, maxRounds, split), 7);
});

test("the DE preset defaults to one entry per bracket and no legacy key", () => {
  const defaults = defaultRoundBestOfForPreset("double_elimination");
  assert.deepEqual(Object.keys(defaults).sort(), ["de_losers", "de_winners"]);

  // Still one stage in the chain, so the emblem row and the stage cards are
  // unchanged — the split lives inside the stage.
  const slots = STAGE_SLOTS_BY_PRESET.double_elimination;
  assert.equal(slots.length, 1);
  assert.equal(slots[0].key, "double_elimination");
  assert.equal(bestOfBlocks(slots[0]).length, 2);
});

test("lengthening either bracket lengthens the schedule estimate", () => {
  const base = defaultRoundBestOfForPreset("double_elimination");
  const minutes = (c: RoundBestOfConfig) => computeStageSchedule("double_elimination", 8, null, c)[0].estimatedMinutes;

  const baseline = minutes(base);
  assert.ok(minutes({ ...base, de_winners: tiers(7, 7, 7, 7) }) > baseline);
  assert.ok(minutes({ ...base, de_losers: tiers(7, 7, 7, 7) }) > baseline);

  // A legacy config estimates as the block it was saved with, rather than
  // falling through to the default.
  assert.equal(minutes({ double_elimination: tiers(7, 7, 7, 7) }), minutes({ de_winners: tiers(7, 7, 7, 7), de_losers: tiers(7, 7, 7, 7) }));
  assert.ok(minutes({ double_elimination: tiers(7, 7, 7, 7) }) > baseline);

  // Uniform tiers are the one case the old distance-from-grand-final formula
  // and the new per-bracket one agree on, which is why the default DE estimate
  // is unchanged: 6 wall-clock slots × BO3 at 8 teams.
  assert.equal(baseline, 180);
});
