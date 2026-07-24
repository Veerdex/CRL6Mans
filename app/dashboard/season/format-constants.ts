// Plain data/logic shared between the season format editor (client) and server
// components (e.g. admin/page.tsx). Deliberately has no "use client" directive —
// importing a runtime value from a "use client" module into a Server Component
// replaces it with a client-reference stub, not the real value, so anything a
// server component needs to read at runtime (PRESETS, DEFAULT_BEST_OF, etc.)
// must live here instead of in format-editor.tsx.

export type PresetId =
  | "single_elimination"
  | "double_elimination"
  | "group_single_elimination"
  | "group_swiss_single_elimination"
  | "group_swiss_hybrid"
  | "group_swiss_hybrid_8"
  | "se_swiss_single_elimination"
  | "de_swiss_single_elimination";

export type RoundTier = "standard" | "quarterfinals" | "semifinals" | "finals";
export type BestOf = 1 | 3 | 5 | 7;

export type SeasonFormatConfig = {
  preset: PresetId;
  groupSeedingMethod?: "balanced" | "random";
  groupMaxAdvancing?: number | null;
  groupRounds?: number | null;
  roundBestOf?: Partial<Record<RoundTier, BestOf>>;
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
