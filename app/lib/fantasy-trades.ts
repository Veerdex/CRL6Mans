// Pure trade rules (docs/fantasy-rl.md §10). No Supabase import, so node --test
// can load it. The trade builder draws its validation from these and the trade
// actions re-check the same functions, so they can't disagree.

import { TIER_LABEL, type FantasyTier } from "./fantasy-pool";
import { LINEUP_SLOTS, type LineupSlot } from "./fantasy-draft";
import type { LineupEntry } from "./fantasy-lineup";

export type TradeStatus = "pending" | "accepted" | "rejected" | "cancelled" | "failed";
export type TradeView = {
  id: string;
  proposerId: string;
  receiverId: string;
  status: TradeStatus;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  items: { playerId: string; fromManagerId: string }[];
};

const TIERS: FantasyTier[] = [1, 2, 3];

function tierCounts(players: readonly { tier: FantasyTier }[]): Record<FantasyTier, number> {
  const counts: Record<FantasyTier, number> = { 1: 0, 2: 0, 3: 0 };
  for (const p of players) counts[p.tier]++;
  return counts;
}

/**
 * Why `give` for `get` isn't a valid trade, or null if it is. Each side gives
 * up the same tiers it gets back, so both rosters stay 2/3/3.
 */
export function tradeShapeProblem(give: readonly { tier: FantasyTier }[], get: readonly { tier: FantasyTier }[]): string | null {
  if (!give.length || !get.length) return "Each side has to give up at least one player.";
  const out = tierCounts(give);
  const back = tierCounts(get);
  const off = TIERS.filter((t) => out[t] !== back[t]);
  if (!off.length) return null;
  const t = off[0];
  return `Trades are like for like: you'd give ${out[t]} ${TIER_LABEL[t]} and get ${back[t]} back.`;
}

export type TradeSide = { managerId: string; lineup: readonly LineupEntry[]; out: readonly string[] };
export type SlotMove = {
  playerId: string;
  fromManagerId: string;
  fromSlot: LineupSlot;
  toManagerId: string;
  toSlot: LineupSlot;
};

const slotOrder = (a: LineupEntry, b: LineupEntry) => LINEUP_SLOTS.indexOf(a.slot) - LINEUP_SLOTS.indexOf(b.slot);

/**
 * Where every player in an accepted trade lands: each one takes the slot of an
 * outgoing player of his tier on the other side, paired in lineup order. Read
 * from the lineups as they are at acceptance, since slots move after a
 * proposal. A string when a player has left his roster since.
 */
export function tradeMoves(a: TradeSide, b: TradeSide): SlotMove[] | string {
  const outgoing = (side: TradeSide) => side.lineup.filter((e) => side.out.includes(e.playerId)).sort(slotOrder);
  const fromA = outgoing(a);
  const fromB = outgoing(b);
  if (fromA.length !== a.out.length || fromB.length !== b.out.length) {
    return "A player in this trade isn't on that roster any more.";
  }
  const shape = tradeShapeProblem(fromA, fromB);
  if (shape) return shape;

  const moves: SlotMove[] = [];
  for (const tier of TIERS) {
    const aTier = fromA.filter((e) => e.tier === tier);
    const bTier = fromB.filter((e) => e.tier === tier);
    aTier.forEach((ea, i) => {
      const eb = bTier[i];
      moves.push({ playerId: ea.playerId, fromManagerId: a.managerId, fromSlot: ea.slot, toManagerId: b.managerId, toSlot: eb.slot });
      moves.push({ playerId: eb.playerId, fromManagerId: b.managerId, fromSlot: eb.slot, toManagerId: a.managerId, toSlot: ea.slot });
    });
  }
  return moves;
}
