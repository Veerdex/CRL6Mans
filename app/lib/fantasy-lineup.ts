// Pure lineup rules (docs/fantasy-rl.md §4 and §6). No Supabase import, so
// node --test can load it. The roster page draws its move targets from these
// and the lineup action re-checks the same functions, so they can't disagree.

import type { FantasyTier } from "./fantasy-pool";
import { slotTier, type LineupSlot } from "./fantasy-draft";

export function slotAccepts(slot: LineupSlot, tier: FantasyTier): boolean {
  const own = slotTier(slot);
  return own === null || own === tier;
}

export type LineupEntry = { slot: LineupSlot; playerId: string; tier: FantasyTier; locked: boolean };

/**
 * Why the player in `from` can't trade places with whoever is in `to`, or null
 * if they can. A move onto an occupied slot is a swap, so both players have to
 * fit where they land and neither may be locked. Tier counts never change: a
 * swap only rearranges the same roster.
 */
export function swapProblem(lineup: readonly LineupEntry[], from: LineupSlot, to: LineupSlot): string | null {
  if (from === to) return "Pick a different slot.";
  const mover = lineup.find((e) => e.slot === from);
  if (!mover) return "There's nobody in that slot to move.";
  const other = lineup.find((e) => e.slot === to);
  if (mover.locked || other?.locked) return "A player whose match has started can't be moved until it's reported.";
  if (!slotAccepts(to, mover.tier)) return `A Tier ${mover.tier} player can't go in that slot.`;
  if (other && !slotAccepts(from, other.tier)) return `That would put a Tier ${other.tier} player in a slot that doesn't take them.`;
  return null;
}

export function moveTargets(lineup: readonly LineupEntry[], from: LineupSlot, slots: readonly LineupSlot[]): LineupSlot[] {
  return slots.filter((to) => to !== from && swapProblem(lineup, from, to) === null);
}

export type LockMatch = {
  home_team_id: string | null;
  away_team_id: string | null;
  status: string;
  scheduled_at: string | null;
};

/**
 * §6: a team is locked from its match's scheduled start until the series is
 * reported. A pending score is still unreported, so it stays locked; a match
 * with no time set never locks.
 */
export function lockedTeams(matches: readonly LockMatch[], now: Date): Set<string> {
  const locked = new Set<string>();
  for (const m of matches) {
    if (m.status === "completed" || m.status === "cancelled") continue;
    if (!m.home_team_id || !m.away_team_id || !m.scheduled_at) continue;
    if (new Date(m.scheduled_at).getTime() > now.getTime()) continue;
    locked.add(m.home_team_id);
    locked.add(m.away_team_id);
  }
  return locked;
}
