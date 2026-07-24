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

import { getTier, getStageSlotKey, type RoundTier, type StageSlotKey } from "@/app/lib/bracket";

export type { RoundTier, StageSlotKey };

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

// Keyed by StageSlotKey — each preset's own set of stage instances gets an
// independent entry, so e.g. an SE qualifier and the final SE bracket in the same
// tournament never share settings even though both are "single_elimination"-shaped.
export type RoundBestOfConfig = Partial<Record<StageSlotKey, StageBestOfConfig>>;

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
};

// Ordered list of independently-configurable best-of slots for each preset.
// Group/Swiss are always "flat" (one BO for every match in the stage); SE/DE
// brackets (qualifier or terminal) are always "tiered" (standard/QF/SF/finals).
// Hybrid brackets are omitted entirely — they're hardcoded to BO7 (see
// getBestOfForMatch) and aren't user-configurable.
export const STAGE_SLOTS_BY_PRESET: Record<PresetId, StageSlotDef[]> = {
  single_elimination: [
    { key: "single_elimination", label: "Single Elimination", kind: "tiered" },
  ],
  double_elimination: [
    { key: "double_elimination", label: "Double Elimination", kind: "tiered" },
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
  ],
  group_swiss_hybrid_8: [
    { key: "group", label: "Group Stage", kind: "flat" },
    { key: "swiss", label: "Swiss Stage", kind: "flat" },
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

export function defaultRoundBestOfForPreset(presetId: PresetId): RoundBestOfConfig {
  const result: RoundBestOfConfig = {};
  for (const slot of STAGE_SLOTS_BY_PRESET[presetId]) {
    result[slot.key] = defaultStageBestOf(slot.kind);
  }
  return result;
}

// Resolves the best-of for one match from its physical stage/round plus the
// tournament's per-slot config. Shared by the admin page, wagers page, match
// predictions, and discord-bot's match-channel/scoring flows so there's one
// canonical place this logic lives. Hybrid stages are always BO7 regardless
// of config; unrecognized/unconfigured stages fall back to `fallback`.
export function resolveBestOf(
  stage: string,
  round: number,
  maxRoundByStage: Record<string, number>,
  config: RoundBestOfConfig | undefined,
  fallback: BestOf = 3
): BestOf {
  if (stage.startsWith("hybrid")) return 7;
  const slotKey = getStageSlotKey(stage);
  const slotConfig = slotKey ? config?.[slotKey] : undefined;
  if (!slotConfig) return fallback;
  if (slotConfig.mode === "flat") return slotConfig.value;
  const totalRounds = maxRoundByStage[stage] ?? round;
  const tier = getTier(round, totalRounds);
  return slotConfig.tiers[tier] ?? fallback;
}
