// Pure waiver and free-agency rules (docs/fantasy-rl.md §9). No Supabase
// import, so node --test can load it. The Players tab draws its Add and Claim
// buttons from these and the actions re-check the same functions, so a button
// shown is a move the server will accept.

import type { FantasyTier } from "./fantasy-pool";
import { pacificOffsetMs } from "./clip-schedule";

/** The daily claims run, in Pacific wall-clock hours. */
export const WAIVER_RUN_HOUR_PACIFIC = 4;
/** The least time a player spends on waivers, so managers always get a chance to claim. */
export const WAIVER_MIN_MS = 12 * 3600_000;

// The run on a Pacific calendar date. The offset is read at that day's noon:
// a daylight saving change happens at 2 AM, so by 4 AM the day's own offset
// already applies.
function runOnPacificDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month, day));
  const noon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), WAIVER_RUN_HOUR_PACIFIC) - pacificOffsetMs(noon),
  );
}

function pacificDate(instant: Date): [number, number, number] {
  const fields = new Date(instant.getTime() + pacificOffsetMs(instant));
  return [fields.getUTCFullYear(), fields.getUTCMonth(), fields.getUTCDate()];
}

/** The most recent run at or before `now`. */
export function latestWaiverRun(now: Date): Date {
  const [y, m, d] = pacificDate(now);
  const today = runOnPacificDate(y, m, d);
  return today.getTime() <= now.getTime() ? today : runOnPacificDate(y, m, d - 1);
}

/** The first run at or after `instant`. */
export function nextWaiverRun(instant: Date): Date {
  const [y, m, d] = pacificDate(instant);
  const today = runOnPacificDate(y, m, d);
  return today.getTime() >= instant.getTime() ? today : runOnPacificDate(y, m, d + 1);
}

/**
 * A player put on waivers at `start` clears in the first run at least 12 hours
 * later: the next morning's run, or the one after if he went on within 12
 * hours of it. So 12 to 36 hours on waivers.
 */
export function waiverClearsAt(start: Date): Date {
  return nextWaiverRun(new Date(start.getTime() + WAIVER_MIN_MS));
}

/**
 * Waiver priority, highest first. Starts as the reverse of the draft order and
 * is stored only once a claim moves someone. Managers who have left are
 * dropped; anyone missing from the stored order (it predates them) goes last.
 */
export function waiverOrder(stored: readonly string[] | null, draftOrder: readonly string[] | null, members: readonly string[]): string[] {
  const base = stored ?? [...(draftOrder ?? [])].reverse();
  const live = new Set(members);
  const order = base.filter((id) => live.has(id));
  for (const id of members) if (!order.includes(id)) order.push(id);
  return order;
}

/**
 * The order after a run. Managers who won nothing move up in their current
 * order; the winners go behind them reversed, so whoever started highest ends
 * up last. Four managers who each win once come out in the opposite order.
 */
export function orderAfterRun(order: readonly string[], winners: Iterable<string>): string[] {
  const won = new Set(winners);
  return [...order.filter((id) => !won.has(id)), ...order.filter((id) => won.has(id)).reverse()];
}

export type PlayerStatus = { kind: "rostered" } | { kind: "waivers"; clearsAt: string } | { kind: "free_agent" };

/**
 * A waiver row holds a player until the run that settles it deletes the row,
 * even once its clear time has passed: otherwise the minutes between the clear
 * time and the run would let a free-agent add jump every pending claim.
 */
export function playerStatus(rostered: boolean, clearsAt: string | null): PlayerStatus {
  if (rostered) return { kind: "rostered" };
  if (clearsAt) return { kind: "waivers", clearsAt };
  return { kind: "free_agent" };
}

export type MovePlayer = { tier: FantasyTier; locked: boolean };

/**
 * Why `add` can't come onto the roster in place of `drop`, or null if it can.
 * Every move is like for like (§4), so rosters stay 2/3/3. A locked player
 * can't be dropped (§6), and a locked player can't be added either: the lineup
 * at report time is what gets credited, so adding him mid-match would bank a
 * series his new manager had already watched.
 */
export function swapInProblem(add: MovePlayer, drop: (MovePlayer & { onRoster: boolean }) | null): string | null {
  if (!drop?.onRoster) return "Pick a player from your roster to drop.";
  if (drop.tier !== add.tier) return `Rosters keep their tiers, so a Tier ${add.tier} player has to replace a Tier ${add.tier} player.`;
  if (drop.locked) return "A player whose match has started can't be dropped until it's reported.";
  if (add.locked) return "That player's match has started. Try again once it's reported.";
  return null;
}

export type PendingClaim = {
  id: string;
  managerId: string;
  playerId: string;
  dropPlayerId: string;
  /** The manager's preference, 1 first. Null on claims filed before ranking existed. */
  rank: number | null;
  createdAt: string;
};
export type ClaimOutcome = { id: string; status: "won" | "lost" | "failed"; note: string | null };

/** A manager's claims in the order they want them, unranked ones last by filing time. */
export function byPreference(a: PendingClaim, b: PendingClaim): number {
  return (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Settles one run. `due` is every player whose waivers have cleared. A player
 * mid-match at the run is skipped: his claims stay pending and he stays on
 * waivers until the next run.
 *
 * Claims go in rounds. In each, every manager from the top of the order down
 * gets their most preferred claim that still works, so nobody wins a second
 * player before everyone has had a shot at a first. Claims passed over on the
 * way are settled as lost (someone above took him) or failed (the swap no
 * longer works). The order doesn't move mid-run; `orderAfterRun` applies once.
 */
export function settleClaims(input: {
  due: readonly string[];
  claims: readonly PendingClaim[];
  order: readonly string[];
  /** manager → the players on their roster */
  rosters: ReadonlyMap<string, ReadonlySet<string>>;
  tierOf: (playerId: string) => FantasyTier | undefined;
  locked: ReadonlySet<string>;
}): { outcomes: ClaimOutcome[]; awards: PendingClaim[]; order: string[]; cleared: string[] } {
  const rosters = new Map([...input.rosters].map(([m, set]) => [m, new Set(set)]));
  const rostered = new Set([...rosters.values()].flatMap((s) => [...s]));
  const cleared = input.due.filter((p) => !input.locked.has(p));
  const settling = new Set(cleared);
  const outcomes: ClaimOutcome[] = [];
  const awards: PendingClaim[] = [];

  const queues = new Map<string, PendingClaim[]>();
  for (const c of input.claims) {
    if (!settling.has(c.playerId)) continue;
    if (!input.order.includes(c.managerId)) {
      outcomes.push({ id: c.id, status: "failed", note: "You're no longer in the league." });
      continue;
    }
    queues.set(c.managerId, [...(queues.get(c.managerId) ?? []), c]);
  }
  for (const q of queues.values()) q.sort(byPreference);

  while ([...queues.values()].some((q) => q.length)) {
    for (const managerId of input.order) {
      const queue = queues.get(managerId) ?? [];
      while (queue.length) {
        const c = queue.shift()!;
        if (awards.some((a) => a.playerId === c.playerId)) {
          outcomes.push({ id: c.id, status: "lost", note: null });
          continue;
        }
        const note = rostered.has(c.playerId)
          ? "He was already on a roster."
          : claimFailure(c, { rosters, tierOf: input.tierOf, locked: input.locked });
        if (note) {
          outcomes.push({ id: c.id, status: "failed", note });
          continue;
        }
        outcomes.push({ id: c.id, status: "won", note: null });
        awards.push(c);
        const roster = rosters.get(c.managerId)!;
        roster.delete(c.dropPlayerId);
        roster.add(c.playerId);
        rostered.delete(c.dropPlayerId);
        rostered.add(c.playerId);
        break;
      }
    }
  }
  return { outcomes, awards, order: orderAfterRun(input.order, awards.map((a) => a.managerId)), cleared };
}

function claimFailure(
  c: PendingClaim,
  s: {
    rosters: Map<string, Set<string>>;
    tierOf: (id: string) => FantasyTier | undefined;
    locked: ReadonlySet<string>;
  },
): string | null {
  const tier = s.tierOf(c.playerId);
  const dropTier = s.tierOf(c.dropPlayerId);
  if (!tier || !dropTier) return "That player isn't in the pool.";
  const problem = swapInProblem(
    { tier, locked: false },
    { tier: dropTier, locked: s.locked.has(c.dropPlayerId), onRoster: s.rosters.get(c.managerId)?.has(c.dropPlayerId) ?? false },
  );
  if (!problem) return null;
  return s.rosters.get(c.managerId)?.has(c.dropPlayerId) ? problem : "The player you meant to drop had already left your roster.";
}
