// Plain data/logic shared between the season format editor (client) and server
// components (e.g. admin/page.tsx). Deliberately has no "use client" directive —
// importing a runtime value from a "use client" module into a Server Component
// replaces it with a client-reference stub, not the real value, so anything a
// server component needs to read at runtime (PRESETS, DEFAULT_BEST_OF, etc.)
// must live here instead of in format-editor.tsx.
//
// Only imports from "@/app/lib/bracket" (also dependency-free) — never from
// "@/app/lib/discord-bot" or any other module that touches supabase/Discord.
// format-editor.tsx ("use client") imports this file, so anything it pulls in
// transitively ships to the browser.

import { getTier, getBestOfKey, type RoundTier, type StageSlotKey, type BestOfKey } from "@/app/lib/bracket";

export type { RoundTier, StageSlotKey, BestOfKey };

export type PresetId =
  | "single_elimination"
  | "double_elimination"
  | "group_single_elimination"
  | "group_swiss_single_elimination"
  | "group_swiss_hybrid"
  | "group_swiss_hybrid_8"
  | "se_swiss_single_elimination"
  | "de_swiss_single_elimination";

export type BestOf = 1 | 3 | 5 | 7;

// Group and Swiss stages play one uniform series length for every match — there's
// no escalating "how close to the final" concept in a round-robin/Swiss stage.
// Bracket-shaped stages (SE/DE, whether a qualifier bracket or the tournament-
// deciding one) keep the standard/QF/SF/finals tiering since they do narrow to a
// single winner.
export type StageBestOfConfig =
  | { mode: "flat"; value: BestOf }
  | { mode: "tiered"; tiers: Record<RoundTier, BestOf> };

// Keyed by BestOfKey — each preset's own set of stage instances gets an
// independent entry, so e.g. an SE qualifier and the final SE bracket in the same
// tournament never share settings even though both are "single_elimination"-shaped.
// A DE bracket contributes two keys ("de_winners", "de_losers") for its one stage.
export type RoundBestOfConfig = Partial<Record<BestOfKey, StageBestOfConfig>>;

export type SeasonFormatConfig = {
  preset: PresetId;
  groupSeedingMethod?: "balanced" | "random";
  groupMaxAdvancing?: number | null;
  groupRounds?: number | null;
  roundBestOf?: RoundBestOfConfig;
};

export type StageType = "group" | "swiss" | "single_elimination" | "double_elimination";

export type PresetDef = {
  id: PresetId;
  name: string;
  stageTypes: StageType[];
  minTeams: number;
  maxTeams?: number;
  description: string;
};

export const PRESETS: PresetDef[] = [
  {
    id: "single_elimination",
    name: "Single Elimination",
    stageTypes: ["single_elimination"],
    minTeams: 4,
    description: "Standard single-elimination bracket.",
  },
  {
    id: "double_elimination",
    name: "Double Elimination",
    stageTypes: ["double_elimination"],
    minTeams: 4,
    description: "Two losses to eliminate; winners and losers brackets.",
  },
  {
    id: "group_single_elimination",
    name: "Group → Single Elimination",
    stageTypes: ["group", "single_elimination"],
    minTeams: 8,
    maxTeams: 64,
    description: "Teams split into groups; top qualifiers enter the SE bracket.",
  },
  {
    id: "group_swiss_single_elimination",
    name: "Group → Swiss → SE",
    stageTypes: ["group", "swiss", "single_elimination"],
    minTeams: 32,
    maxTeams: 64,
    description: "Groups narrow to 16 → Swiss (16→8) → SE finals.",
  },
  {
    id: "group_swiss_hybrid",
    name: "Group → Swiss → Hybrid(12)",
    stageTypes: ["group", "swiss", "double_elimination"],
    minTeams: 24,
    maxTeams: 32,
    description: "4 groups: 1sts → UB, 2nd–5th → Swiss. Swiss top 8 → LB. 12-team hybrid bracket.",
  },
  {
    id: "group_swiss_hybrid_8",
    name: "Group → Swiss → Hybrid(8)",
    stageTypes: ["group", "swiss", "double_elimination"],
    minTeams: 16,
    maxTeams: 32,
    description: "4 groups: 1sts → UB, 2nd–3rd → Swiss. Swiss top 4 → LB. 8-team hybrid bracket.",
  },
  {
    id: "se_swiss_single_elimination",
    name: "SE Qualifier → Swiss → SE",
    stageTypes: ["single_elimination", "swiss", "single_elimination"],
    minTeams: 32,
    description: "SE qualifier narrows to 16 → Swiss (16→8) → SE finals.",
  },
  {
    id: "de_swiss_single_elimination",
    name: "DE Qualifier → Swiss → SE",
    stageTypes: ["double_elimination", "swiss", "single_elimination"],
    minTeams: 32,
    description: "DE qualifier narrows to 16 → Swiss (16→8) → SE finals.",
  },
];

// Generic, player-facing explanation of how each stage type plays out —
// shown on the tournament detail page's Format tab. Independent of the
// preset-level `description` above (which explains how stages connect to
// each other, not how any single stage works).
export const STAGE_TYPE_DESCRIPTIONS: Record<StageType, string> = {
  group: "Teams are split into groups and play round-robin within their group. The top finishers in each group advance to the next stage.",
  swiss: "Teams are paired each round against an opponent with a similar record, without repeat matchups. After a fixed number of rounds, the top finishers advance.",
  single_elimination: "One loss and a team is out. Winners advance each round until a single champion remains.",
  double_elimination: "A team must lose twice to be eliminated — a winners bracket and a losers bracket run in parallel, and the winners bracket champion faces the losers bracket champion in the grand final.",
};

export function stageDescription(slotKey: StageSlotKey, stageType: StageType): string {
  if (slotKey === "hybrid") {
    return "A double-elimination bracket where teams start in either the upper or lower bracket based on how they qualified. Two losses eliminates a team; the upper and lower bracket winners meet in the grand final.";
  }
  return STAGE_TYPE_DESCRIPTIONS[stageType];
}

export const TIER_LABELS: Record<RoundTier, string> = {
  standard: "Standard Rounds",
  quarterfinals: "Quarterfinals",
  semifinals: "Semifinals",
  finals: "Finals",
};
export const BO_OPTIONS: BestOf[] = [1, 3, 5, 7];

export function getNumGroups(teams: number): number {
  if (teams > 32) return 8;
  if (teams > 16) return 4;
  return 2;
}

export function getDefaultGroupAdvancing(teams: number): number {
  const ng = getNumGroups(teams);
  const natural = Math.floor((teams * 3) / 4);
  return Math.floor(natural / ng) * ng;
}

// Mirrors ROUNDS_BY_GROUP_SIZE in bracket-server.ts — kept in sync manually
// since that one is server-only.
const ROUNDS_BY_GROUP_SIZE: Record<number, number> = { 3: 8, 4: 6, 5: 8, 6: 5, 7: 6, 8: 7 };
export function getDefaultGroupRounds(teams: number): number {
  const ng = getNumGroups(teams);
  const minGroupSize = Math.floor(teams / ng);
  return ROUNDS_BY_GROUP_SIZE[minGroupSize] ?? Math.max(1, minGroupSize - 1);
}

export const TIER_ORDER: RoundTier[] = ["standard", "quarterfinals", "semifinals", "finals"];
export const DEFAULT_BEST_OF: Record<RoundTier, BestOf> = {
  standard: 3, quarterfinals: 3, semifinals: 3, finals: 3,
};

export function applyBestOfCascade(
  current: Record<RoundTier, BestOf>,
  changedTier: RoundTier,
  newValue: BestOf
): Record<RoundTier, BestOf> {
  const result = { ...current, [changedTier]: newValue };
  const tierIdx = TIER_ORDER.indexOf(changedTier);
  // Push higher tiers up if they're below the new value
  for (let i = tierIdx + 1; i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i];
    if (result[tier] < newValue) result[tier] = newValue;
  }
  // Pull lower tiers down if they're above the new value
  for (let i = tierIdx - 1; i >= 0; i--) {
    const tier = TIER_ORDER[i];
    if (result[tier] > newValue) result[tier] = newValue;
  }
  return result;
}

// ── Per-stage best-of slots ─────────────────────────────────────────────────

export type StageSlotDef = {
  key: StageSlotKey;
  label: string;
  kind: "flat" | "tiered";
  // A stage whose best-of is configured as more than one block. The slot stays
  // one entry in the preset's chain — one emblem, one description, one stage
  // card — and these are the settings groups rendered inside it. A block may
  // override the stage's kind: a single-match block has no tier ladder to scale.
  subSlots?: { key: BestOfKey; label: string; kind?: "flat" | "tiered" }[];
};

// Ordered list of each preset's stages, and the one list every stage chain is
// drawn from: PresetEmblemRow walks it for the emblem row, and
// tournament-detail.tsx pairs it positionally with PresetDef.stageTypes. One
// entry per stage, therefore — a stage needing two best-of blocks declares
// subSlots rather than a second entry here.
//
// Group/Swiss are always "flat" (one BO for every match in the stage); SE/DE/
// hybrid brackets (qualifier or terminal) are always "tiered" (standard/QF/SF/
// finals).
export const STAGE_SLOTS_BY_PRESET: Record<PresetId, StageSlotDef[]> = {
  single_elimination: [
    { key: "single_elimination", label: "Single Elimination", kind: "tiered" },
  ],
  double_elimination: [
    {
      key: "double_elimination",
      label: "Double Elimination",
      kind: "tiered",
      // Two brackets run side by side at different stakes: a winners-bracket
      // round decides who stays undefeated, while the losers round beside it is
      // elimination. One tier grid for both could only ever suit one of them.
      // The grand final is a third block because it is a different match from
      // the winners final even though both land on the finals tier — a format
      // that runs its bracket short and the title series long is the normal
      // case, not an exception. One match, so one value: flat.
      subSlots: [
        { key: "de_winners", label: "Winners Bracket" },
        { key: "de_losers", label: "Losers Bracket" },
        { key: "de_grand_final", label: "Grand Final", kind: "flat" },
      ],
    },
  ],
  group_single_elimination: [
    { key: "group", label: "Group Stage", kind: "flat" },
    { key: "single_elimination", label: "Single Elimination", kind: "tiered" },
  ],
  group_swiss_single_elimination: [
    { key: "group", label: "Group Stage", kind: "flat" },
    { key: "swiss", label: "Swiss Stage", kind: "flat" },
    { key: "single_elimination", label: "Single Elimination Finals", kind: "tiered" },
  ],
  group_swiss_hybrid: [
    { key: "group", label: "Group Stage", kind: "flat" },
    { key: "swiss", label: "Swiss Stage", kind: "flat" },
    { key: "hybrid", label: "Hybrid Bracket", kind: "tiered" },
  ],
  group_swiss_hybrid_8: [
    { key: "group", label: "Group Stage", kind: "flat" },
    { key: "swiss", label: "Swiss Stage", kind: "flat" },
    { key: "hybrid", label: "Hybrid Bracket", kind: "tiered" },
  ],
  se_swiss_single_elimination: [
    { key: "se_qualifier", label: "SE Qualifier", kind: "tiered" },
    { key: "swiss", label: "Swiss Stage", kind: "flat" },
    { key: "single_elimination", label: "Single Elimination Finals", kind: "tiered" },
  ],
  de_swiss_single_elimination: [
    { key: "de_qualifier", label: "DE Qualifier", kind: "tiered" },
    { key: "swiss", label: "Swiss Stage", kind: "flat" },
    { key: "single_elimination", label: "Single Elimination Finals", kind: "tiered" },
  ],
};

export function defaultStageBestOf(kind: "flat" | "tiered"): StageBestOfConfig {
  return kind === "flat" ? { mode: "flat", value: 3 } : { mode: "tiered", tiers: { ...DEFAULT_BEST_OF } };
}

export type BestOfBlock = { key: BestOfKey; label: string; kind: "flat" | "tiered" };

// The settings groups a stage's best-of is edited and displayed as. Every
// consumer that reads or writes config[...] for a slot goes through this rather
// than indexing on slot.key, so a split stage can't be half-handled.
export function bestOfBlocks(slot: StageSlotDef): BestOfBlock[] {
  if (!slot.subSlots) return [{ key: slot.key, label: slot.label, kind: slot.kind }];
  return slot.subSlots.map((s) => ({ ...s, kind: s.kind ?? slot.kind }));
}

// Which kind each block is edited as, read off the slot defs so it can't drift
// from what the editors render. Legacy keys a block was split out of aren't in
// here — nothing edits those any more.
const BLOCK_KIND_BY_KEY: Partial<Record<BestOfKey, "flat" | "tiered">> = (() => {
  const kinds: Partial<Record<BestOfKey, "flat" | "tiered">> = {};
  for (const slots of Object.values(STAGE_SLOTS_BY_PRESET)) {
    for (const slot of slots) {
      for (const block of bestOfBlocks(slot)) kinds[block.key] = block.kind;
    }
  }
  return kinds;
})();

// Carrying an inherited block across a kind boundary: a tiered block becomes the
// value its finals tier already resolved to, which for the grand final is the
// exact number the old combined winners block produced for it.
function coerceToKind(config: StageBestOfConfig, kind: "flat" | "tiered"): StageBestOfConfig {
  if (kind === "flat") {
    return config.mode === "flat" ? config : { mode: "flat", value: config.tiers.finals };
  }
  if (config.mode === "tiered") return config;
  const { value } = config;
  return { mode: "tiered", tiers: { standard: value, quarterfinals: value, semifinals: value, finals: value } };
}

// Stages whose best-of used to be fewer blocks than it is now, mapped to the
// keys a new block inherits from, nearest first. A tournament configured before
// a split has only the old key, and every consumer — both editors' initial state
// and dirty checks, the read-only summaries, resolveBestOf, computeStageSchedule
// — must see the values the admin actually set rather than fall through to
// defaults: an in-flight DE bracket would otherwise silently revert to BO3, and
// the editor would read as permanently unsaved. The grand final's chain is two
// splits deep (double_elimination → de_winners → de_grand_final), which is why
// these are lists.
const SPLIT_FROM: Partial<Record<BestOfKey, BestOfKey[]>> = {
  de_winners: ["double_elimination"],
  de_losers: ["double_elimination"],
  de_grand_final: ["de_winners", "double_elimination"],
};

// Pure and idempotent: fills in a split stage's new keys from the blocks they
// were split out of, coerced to the kind the new block is edited as. Each key
// reads the partially-filled result, so the fill order doesn't matter — a chain
// resolves either through its nearest ancestor or straight from the oldest key.
// Saving re-trims to the new keys, so this only ever has work to do until the
// next save.
export function normalizeRoundBestOf(config: RoundBestOfConfig | undefined): RoundBestOfConfig {
  if (!config) return {};
  let result = config;
  for (const [key, legacyKeys] of Object.entries(SPLIT_FROM) as [BestOfKey, BestOfKey[]][]) {
    if (result[key]) continue;
    const inherited = legacyKeys.map((k) => result[k]).find((c) => c !== undefined);
    if (!inherited) continue;
    if (result === config) result = { ...config };
    result[key] = coerceToKind(inherited, BLOCK_KIND_BY_KEY[key] ?? "tiered");
  }
  return result;
}

export function defaultRoundBestOfForPreset(presetId: PresetId): RoundBestOfConfig {
  const result: RoundBestOfConfig = {};
  for (const slot of STAGE_SLOTS_BY_PRESET[presetId]) {
    for (const block of bestOfBlocks(slot)) result[block.key] = defaultStageBestOf(block.kind);
  }
  return result;
}

// ── Stage schedule estimates ────────────────────────────────────────────────
// How long each stage of a format is expected to take, derived from the number
// of rounds it runs and the best-of configured for those rounds. The admin
// editor uses this to lay out stage start times; the dashboard cards use it to
// project when a tournament will finish.

export type StageScheduleEntry = {
  key: string;
  label: string;
  estimatedMinutes: number;
};

// Per-match spacing: 8 minutes per game in the series, rounded up to the next 5,
// plus 5 for the check-in window every round opens before anyone can play. The
// games charged are the series maximum, so a BO3 that ends 2-0 finishes early.
const CHECKIN_ALLOWANCE_MIN = 5;
function gapMin(bo: BestOf): number {
  return Math.ceil((8 * bo) / 5) * 5 + CHECKIN_ALLOWANCE_MIN;
}

const log2ceil = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

// Sum the spacing for a sequence of single-elimination rounds, mapping the final
// rounds to the QF/SF/Final tiers (matches getSeedOrder/SE bracket structure).
function seRoundsDuration(totalRounds: number, bof: Record<RoundTier, BestOf>): number {
  let dur = 0;
  for (let r = 0; r < totalRounds; r++) {
    const rem = totalRounds - r;
    if (rem === 1) dur += gapMin(bof.finals);
    else if (rem === 2) dur += gapMin(bof.semifinals);
    else if (rem === 3) dur += gapMin(bof.quarterfinals);
    else dur += gapMin(bof.standard);
  }
  return dur;
}

// All groups play (minGroupSize - 1) * 2 rounds. The smallest group gets a full
// double RR; larger groups exhaust single-RR then fill remaining rounds from pass 2.
function groupStageRounds(teams: number): number {
  const ng = getNumGroups(teams);
  const minSize = Math.floor(teams / ng); // smallest group (floor of even split)
  return (minSize - 1) * 2;
}

// Double-elimination wall-clock duration: WB = log2(size), LB = 2·(log2(size)−1),
// plus the grand final. LB starts one slot late — wbLoserTarget(1, …) sends WB
// R1's losers to LB R1, so LB R1 cannot run beside WB R1. For 8 teams the path is
// WB R1, (WB R2 ‖ LB R1), (WB F ‖ LB R2), LB R3, LB F, GF. The grand final's
// bracket reset is conditional and not counted. (bracket.ts)
//
// A slot holding one round from each bracket costs the longer of the two, not the
// losers round alone: the brackets have separate best-of settings, so lengthening
// only the winners bracket has to move the estimate or the setting looks inert.
function deDuration(
  teams: number,
  wbTiers: Record<RoundTier, BestOf>,
  lbTiers: Record<RoundTier, BestOf>,
  gfBestOf: BestOf,
): number {
  if (teams <= 2) return gapMin(gfBestOf);
  const wb = log2ceil(teams);
  const lb = 2 * (wb - 1);
  let dur = gapMin(wbTiers[getTier(1, wb)]);
  for (let k = 1; k <= lb; k++) {
    const lbGap = gapMin(lbTiers[getTier(k, lb)]);
    const wbRound = k + 1;
    dur += wbRound <= wb ? Math.max(lbGap, gapMin(wbTiers[getTier(wbRound, wb)])) : lbGap;
  }
  return dur + gapMin(gfBestOf);
}

// Swiss runs until every team reaches 3 wins or 3 losses → at most 5 rounds, all standard.
const SWISS_ROUNDS = 5;

// The keys edited as one value rather than a tier grid. Splitting the accessors
// on this union is what stops a flat block being read for tiers it never has.
type FlatBestOfKey = "group" | "swiss" | "de_grand_final";

function slotFlatBO(config: RoundBestOfConfig, key: FlatBestOfKey): BestOf {
  const c = config[key];
  return c?.mode === "flat" ? c.value : 3;
}
function slotTiers(config: RoundBestOfConfig, key: Exclude<BestOfKey, FlatBestOfKey>): Record<RoundTier, BestOf> {
  const c = config[key];
  return c?.mode === "tiered" ? c.tiers : DEFAULT_BEST_OF;
}

export function computeStageSchedule(
  preset: string,
  teams: number,
  groupMaxAdvancing: number | null,
  storedConfig: RoundBestOfConfig,
  groupRounds: number | null = null,
): StageScheduleEntry[] {
  if (teams < 2) return [];
  const config = normalizeRoundBestOf(storedConfig);

  const groupStd = gapMin(slotFlatBO(config, "group"));
  const swissStd = gapMin(slotFlatBO(config, "swiss"));

  const groups = { key: "groups", label: "Groups", estimatedMinutes: (groupRounds ?? groupStageRounds(teams)) * groupStd };
  const swiss  = { key: "swiss", label: "Swiss", estimatedMinutes: SWISS_ROUNDS * swissStd };
  const se8    = { key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(3, slotTiers(config, "single_elimination")) }; // 8→1: QF+SF+Final

  switch (preset) {
    case "single_elimination":
      return [{ key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(log2ceil(teams), slotTiers(config, "single_elimination")) }];

    case "double_elimination":
      return [{ key: "bracket", label: "Bracket", estimatedMinutes: deDuration(
        teams,
        slotTiers(config, "de_winners"),
        slotTiers(config, "de_losers"),
        slotFlatBO(config, "de_grand_final"),
      ) }];

    case "group_single_elimination": {
      const adv = groupMaxAdvancing ?? getDefaultGroupAdvancing(teams);
      return [
        groups,
        { key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(log2ceil(adv), slotTiers(config, "single_elimination")) },
      ];
    }

    case "group_swiss_single_elimination":
      return [groups, swiss, se8];

    case "group_swiss_hybrid":
      // 5 wall-clock rounds: (UB QF ‖ LB R1), LB R2, LB QF, SF, GF — mapped to
      // standard/standard/quarterfinals/semifinals/finals tiers, same as an SE bracket.
      return [
        groups,
        swiss,
        { key: "hybrid", label: "Hybrid(12)", estimatedMinutes: seRoundsDuration(5, slotTiers(config, "hybrid")) },
      ];

    case "group_swiss_hybrid_8":
      // 4 wall-clock rounds: (UB QF ‖ LB R1), LB QF, SF, GF — mapped to
      // standard/quarterfinals/semifinals/finals tiers, same as an SE bracket.
      return [
        groups,
        swiss,
        { key: "hybrid", label: "Hybrid(8)", estimatedMinutes: seRoundsDuration(4, slotTiers(config, "hybrid")) },
      ];

    case "se_swiss_single_elimination": {
      // SE qualifier narrows N → 16: log2(N) − log2(16) rounds.
      const qualRounds = Math.max(1, log2ceil(teams) - 4);
      return [
        { key: "se_qualifier", label: "SE Qualifier", estimatedMinutes: seRoundsDuration(qualRounds, slotTiers(config, "se_qualifier")) },
        swiss,
        se8,
      ];
    }

    case "de_swiss_single_elimination": {
      // DE qualifier narrows N → 16: WB k = log2(size/8), LB = 2·(k−1). The two
      // run in parallel, but the qualifier routes WB losers through the same
      // wbLoserTarget as a full DE, so its LB R1 also waits on WB R1 — one slot
      // late, and no grand final to add. k = 1 means no LB rounds at all.
      const k = Math.max(1, log2ceil(teams) - 3);
      const lbq = 2 * (k - 1);
      const qualRounds = Math.max(k, lbq > 0 ? 1 + lbq : 0);
      return [
        { key: "de_qualifier", label: "DE Qualifier", estimatedMinutes: seRoundsDuration(qualRounds, slotTiers(config, "de_qualifier")) },
        swiss,
        se8,
      ];
    }

    default:
      return [];
  }
}

// Resolves the best-of for one match from its physical stage/round plus the
// tournament's per-slot config. Shared by the admin page, wagers page, match
// predictions, and discord-bot's match-channel/scoring flows so there's one
// canonical place this logic lives. Unrecognized/unconfigured stages fall
// back to `fallback`.
export function resolveBestOf(
  stage: string,
  round: number,
  maxRoundByStage: Record<string, number>,
  config: RoundBestOfConfig | undefined,
  fallback: BestOf = 3
): BestOf {
  const slotKey = getBestOfKey(stage);
  const slotConfig = slotKey ? normalizeRoundBestOf(config)[slotKey] : undefined;
  if (!slotConfig) return fallback;
  if (slotConfig.mode === "flat") return slotConfig.value;
  const totalRounds = maxRoundByStage[stage] ?? round;
  const tier = getTier(round, totalRounds);
  return slotConfig.tiers[tier] ?? fallback;
}
