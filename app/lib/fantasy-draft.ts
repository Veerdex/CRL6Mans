// Pure fantasy draft and roster rules (docs/fantasy-rl.md §4 and §8). No
// Supabase import, so node --test can load it. The pick action, the autopick
// and the pages all read these, so what a page offers and what an action
// accepts can't disagree.

import type { FantasyTier } from "./fantasy-pool";

export const ROSTER_TIER_LIMITS: Record<FantasyTier, number> = { 1: 2, 2: 3, 3: 3 };
export const ROSTER_SIZE = 8;
export const FANTASY_PICK_SECONDS = 90;
/** The draft's opening pick gets longer, so every manager has time to arrive. */
export const FANTASY_FIRST_PICK_SECONDS = 5 * 60;

export const LINEUP_SLOTS = ["cap", "first1", "first2", "second1", "second2", "flex", "bench1", "bench2"] as const;
export type LineupSlot = (typeof LINEUP_SLOTS)[number];

export const SLOT_LABEL: Record<LineupSlot, string> = {
  cap: "Cap",
  first1: "1st",
  first2: "1st",
  second1: "2nd",
  second2: "2nd",
  flex: "Flex",
  bench1: "Bench",
  bench2: "Bench",
};

/** The tier a slot takes, or null for Flex and the bench, which take any. */
export function slotTier(slot: LineupSlot): FantasyTier | null {
  if (slot === "cap") return 1;
  if (slot === "first1" || slot === "first2") return 2;
  if (slot === "second1" || slot === "second2") return 3;
  return null;
}

export const isStarterSlot = (slot: LineupSlot) => slot !== "bench1" && slot !== "bench2";

export const totalDraftPicks = (managers: number) => managers * ROSTER_SIZE;

/** Snake order: round 1 runs down the draft order, round 2 back up, and so on. */
export function managerIndexForPick(pick: number, managers: number): number {
  const round = Math.floor(pick / managers);
  const seat = pick % managers;
  return round % 2 === 0 ? seat : managers - 1 - seat;
}

export const pickRound = (pick: number, managers: number) => Math.floor(pick / managers) + 1;

export type TierCounts = Record<FantasyTier, number>;

export function tierCounts(tiers: FantasyTier[]): TierCounts {
  const counts: TierCounts = { 1: 0, 2: 0, 3: 0 };
  for (const t of tiers) counts[t] += 1;
  return counts;
}

export const tierNeeded = (counts: TierCounts, tier: FantasyTier) => counts[tier] < ROSTER_TIER_LIMITS[tier];

/**
 * Where a newly drafted player lands: the tier's own starting slots first,
 * then Flex, then the bench. Under the 2/3/3 limits each tier has exactly one
 * player past its own slots, and those three fill Flex and both bench spots,
 * so a tier-legal pick always has somewhere to go.
 */
export function slotForPick(filled: ReadonlySet<LineupSlot>, tier: FantasyTier): LineupSlot | null {
  const own = LINEUP_SLOTS.filter((s) => slotTier(s) === tier);
  for (const s of [...own, "flex", "bench1", "bench2"] as LineupSlot[]) {
    if (!filled.has(s)) return s;
  }
  return null;
}

export type DraftCandidate = { id: string; tier: FantasyTier; rating: number };

/** §8: the best available by tier, then rating, among the tiers still needed. */
export function chooseAutopick(available: DraftCandidate[], counts: TierCounts): DraftCandidate | null {
  const eligible = available.filter((p) => tierNeeded(counts, p.tier));
  eligible.sort((a, b) => a.tier - b.tier || b.rating - a.rating || a.id.localeCompare(b.id));
  return eligible[0] ?? null;
}

/** Tiers the pool can't fill for this many managers, so the draft would stall. */
export function poolShortfall(pool: TierCounts, managers: number): FantasyTier[] {
  return ([1, 2, 3] as FantasyTier[]).filter((t) => pool[t] < ROSTER_TIER_LIMITS[t] * managers);
}

export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
