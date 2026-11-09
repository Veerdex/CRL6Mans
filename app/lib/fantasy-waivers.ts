// Pure waiver and free-agency rules (docs/fantasy-rl.md §9). No Supabase
// import, so node --test can load it. The Players tab draws its Add and Claim
// buttons from these and the actions re-check the same functions, so a button
// shown is a move the server will accept.

import type { FantasyTier } from "./fantasy-pool";
import { pacificOffsetMs } from "./clip-schedule";

/** The daily claims run, in Pacific wall-clock hours. */
export const WAIVER_RUN_HOUR_PACIFIC = 4;
export const WAIVER_PERIOD_MS = 24 * 3600_000;

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

/** A player put on waivers at `start` clears in the first run once his 24 hours are up. */
export function waiverClearsAt(start: Date): Date {
  return nextWaiverRun(new Date(start.getTime() + WAIVER_PERIOD_MS));
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

/** A successful claim sends that manager to the back; everyone behind them moves up. */
export function moveToBack(order: readonly string[], managerId: string): string[] {
  return [...order.filter((id) => id !== managerId), managerId];
}

export type PlayerStatus = { kind: "rostered" } | { kind: "waivers"; clearsAt: string } | { kind: "free_agent" };

export function playerStatus(rostered: boolean, clearsAt: string | null, now: Date): PlayerStatus {
  if (rostered) return { kind: "rostered" };
  if (clearsAt && new Date(clearsAt).getTime() > now.getTime()) return { kind: "waivers", clearsAt };
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

export type PendingClaim = { id: string; managerId: string; playerId: string; dropPlayerId: string; createdAt: string };
export type ClaimOutcome = { id: string; status: "won" | "lost" | "failed"; note: string | null };

/**
 * Settles one run. `due` is every player whose waivers have cleared, oldest
 * first. Each goes to the highest-priority manager whose claim is still good
 * against the rosters as they stand after the claims settled before it, and
 * that manager moves to the back. A player who is mid-match at the run is
 * skipped: his claims stay pending and he stays on waivers until the next run.
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
  let order = [...input.order];
  const outcomes: ClaimOutcome[] = [];
  const awards: PendingClaim[] = [];
  const cleared: string[] = [];

  for (const playerId of input.due) {
    if (input.locked.has(playerId)) continue;
    cleared.push(playerId);
    const claims = input.claims
      .filter((c) => c.playerId === playerId)
      .sort((a, b) => rank(order, a.managerId) - rank(order, b.managerId) || a.createdAt.localeCompare(b.createdAt));
    let winner: PendingClaim | null = null;
    for (const c of claims) {
      if (winner) {
        outcomes.push({ id: c.id, status: "lost", note: null });
        continue;
      }
      const note = claimFailure(c, { rosters, rostered, tierOf: input.tierOf, locked: input.locked, order });
      if (note) {
        outcomes.push({ id: c.id, status: "failed", note });
        continue;
      }
      winner = c;
      outcomes.push({ id: c.id, status: "won", note: null });
      awards.push(c);
      const roster = rosters.get(c.managerId)!;
      roster.delete(c.dropPlayerId);
      roster.add(playerId);
      rostered.delete(c.dropPlayerId);
      rostered.add(playerId);
      order = moveToBack(order, c.managerId);
    }
  }
  return { outcomes, awards, order, cleared };
}

const rank = (order: readonly string[], managerId: string) => {
  const i = order.indexOf(managerId);
  return i === -1 ? order.length : i;
};

function claimFailure(
  c: PendingClaim,
  s: {
    rosters: Map<string, Set<string>>;
    rostered: Set<string>;
    tierOf: (id: string) => FantasyTier | undefined;
    locked: ReadonlySet<string>;
    order: readonly string[];
  },
): string | null {
  if (!s.order.includes(c.managerId)) return "You're no longer in the league.";
  if (s.rostered.has(c.playerId)) return "He was already on a roster.";
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
