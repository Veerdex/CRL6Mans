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

test("normalizeRoundBestOf is idempotent and leaves a fully-split config alone", () => {
  const legacy: RoundBestOfConfig = { double_elimination: tiers(1, 5, 5, 7) };
  const once = normalizeRoundBestOf(legacy);
  assert.deepEqual(normalizeRoundBestOf(once), once);

  const split: RoundBestOfConfig = {
    double_elimination: tiers(1, 1, 1, 1),
    de_winners: tiers(3, 3, 5, 7),
    de_losers: tiers(1, 1, 3, 5),
    de_grand_final: { mode: "flat", value: 5 },
  };
  assert.deepEqual(normalizeRoundBestOf(split), split);
  assert.deepEqual(normalizeRoundBestOf(undefined), {});
});

test("the grand final is derived as a flat block, from the nearest key it was split out of", () => {
  // Production shape: the winners/losers split was saved, the grand final split
  // wasn't. It inherits the winners finals tier — the value it already resolved
  // to — rather than reverting to BO3.
  const preGf = normalizeRoundBestOf({ de_winners: tiers(3, 3, 5, 7), de_losers: tiers(1, 1, 1, 3) });
  assert.deepEqual(preGf.de_grand_final, { mode: "flat", value: 7 });

  // Pre-split, with no de_winners to read: straight from the oldest key.
  const preSplit = normalizeRoundBestOf({ double_elimination: tiers(1, 5, 5, 7) });
  assert.deepEqual(preSplit.de_grand_final, { mode: "flat", value: 7 });
  assert.deepEqual(normalizeRoundBestOf(preSplit), preSplit);
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

  // Only derived from the winners finals tier, so it matches until it's set.
  assert.equal(resolveBestOf(DE_GF, 1, maxRounds, split), 7);
});

test("the grand final is independent of the winners bracket once set", () => {
  const config: RoundBestOfConfig = {
    de_winners: tiers(3, 3, 5, 5),
    de_losers: tiers(1, 1, 1, 3),
    de_grand_final: { mode: "flat", value: 7 },
  };
  // The winners final and the grand final both sit on the finals tier; the whole
  // point of the split is that they no longer have to be the same length.
  assert.equal(resolveBestOf(DE_WINNERS, 3, maxRounds, config), 5);
  assert.equal(resolveBestOf(DE_GF, 1, maxRounds, config), 7);

  // Moving the winners bracket no longer drags the title series with it.
  const longerWb = { ...config, de_winners: tiers(7, 7, 7, 7) };
  assert.equal(resolveBestOf(DE_GF, 1, maxRounds, longerWb), 7);
});

test("the DE preset defaults to one entry per block and no legacy key", () => {
  const defaults = defaultRoundBestOfForPreset("double_elimination");
  assert.deepEqual(Object.keys(defaults).sort(), ["de_grand_final", "de_losers", "de_winners"]);
  // One match, so one value — never a tier grid.
  assert.deepEqual(defaults.de_grand_final, { mode: "flat", value: 3 });

  // Still one stage in the chain, so the emblem row and the stage cards are
  // unchanged — the split lives inside the stage.
  const slots = STAGE_SLOTS_BY_PRESET.double_elimination;
  assert.equal(slots.length, 1);
  assert.equal(slots[0].key, "double_elimination");
  assert.equal(bestOfBlocks(slots[0]).length, 3);
  assert.equal(bestOfBlocks(slots[0]).find((b) => b.key === "de_grand_final")?.kind, "flat");
});

test("lengthening either bracket lengthens the schedule estimate", () => {
  const base = defaultRoundBestOfForPreset("double_elimination");
  const minutes = (c: RoundBestOfConfig) => computeStageSchedule("double_elimination", 8, null, c)[0].estimatedMinutes;

  const baseline = minutes(base);
  assert.ok(minutes({ ...base, de_winners: tiers(7, 7, 7, 7) }) > baseline);
  assert.ok(minutes({ ...base, de_losers: tiers(7, 7, 7, 7) }) > baseline);
  // The grand final is its own wall-clock slot, so its setting has to move the
  // estimate on its own or the block reads as inert.
  assert.ok(minutes({ ...base, de_grand_final: { mode: "flat", value: 7 } }) > baseline);

  // A legacy config estimates as the block it was saved with, rather than
  // falling through to the default.
  assert.equal(minutes({ double_elimination: tiers(7, 7, 7, 7) }), minutes({ de_winners: tiers(7, 7, 7, 7), de_losers: tiers(7, 7, 7, 7) }));
  assert.ok(minutes({ double_elimination: tiers(7, 7, 7, 7) }) > baseline);

  // Uniform tiers are the one case the old distance-from-grand-final formula
  // and the new per-bracket one agree on, which is why the default DE estimate
  // is unchanged: 6 wall-clock slots × BO3 at 8 teams.
  assert.equal(baseline, 180);
});
