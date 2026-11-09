// Pure fantasy season structure (docs/fantasy-rl.md §7): weekly pairings,
// standings and the playoff bracket. No Supabase import, so node --test can
// load it. Nothing here is stored: the round robin comes from the league's
// fixed draft order and the playoffs from the standings, so both are derived
// on read from the same inputs every time.

export type WeekKind = "regular" | "semifinal" | "final";

/** b is null for a bye. */
export type Pairing = { a: string; b: string | null };

export type Matchup = Pairing & {
  aPoints: number;
  bPoints: number;
  /** Set once the week has closed. Null for a tie or a bye. */
  winner: string | null;
};

export type ScheduleWeek = {
  week: number;
  kind: WeekKind;
  closed: boolean;
  matchups: Matchup[];
  /** A playoff week whose seeds or semifinal winners aren't known yet. */
  pending: boolean;
};

export type Standing = {
  managerId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

export type Schedule = { weeks: ScheduleWeek[]; standings: Standing[]; champion: string | null };

/** Two playoff weeks (semifinals, final) with 4+ managers, a final alone with fewer, none in a season under 3 weeks. */
export function playoffWeekCount(totalWeeks: number, managerCount: number): number {
  if (totalWeeks < 3 || managerCount < 2) return 0;
  return managerCount >= 4 ? 2 : 1;
}

/**
 * Circle-method round robin: managers[0] stays put and the rest rotate one
 * place a week, so every pair meets once per cycle and the cycle repeats.
 * An odd count adds a phantom seat whose opponent has the bye.
 */
export function roundRobinWeek(managers: string[], weekIndex: number): Pairing[] {
  if (managers.length < 2) return managers.map((a) => ({ a, b: null }));
  const seats: (string | null)[] = managers.length % 2 ? [...managers, null] : [...managers];
  const n = seats.length;
  const rest = seats.slice(1);
  const shift = weekIndex % (n - 1);
  const order = [seats[0], ...rest.map((_, i) => rest[(i - shift + rest.length) % rest.length])];
  const pairings: Pairing[] = [];
  for (let i = 0; i < n / 2; i++) {
    const x = order[i];
    const y = order[n - 1 - i];
    if (x === null) pairings.push({ a: y!, b: null });
    else pairings.push({ a: x, b: y });
  }
  return pairings;
}

function decide(m: Pairing, aPoints: number, bPoints: number, closed: boolean, tieGoesTo?: string): Matchup {
  let winner: string | null = null;
  if (closed && m.b !== null) {
    if (aPoints > bPoints) winner = m.a;
    else if (bPoints > aPoints) winner = m.b;
    else winner = tieGoesTo ?? null;
  }
  return { ...m, aPoints, bPoints, winner };
}

/** W-L with total points as the tiebreak, then draft order. Only closed regular-season weeks count. */
export function standingsFrom(managers: string[], weeks: ScheduleWeek[]): Standing[] {
  const table = new Map(managers.map((id) => [id, { managerId: id, wins: 0, losses: 0, ties: 0, pointsFor: 0 }]));
  for (const w of weeks) {
    if (w.kind !== "regular" || !w.closed) continue;
    for (const m of w.matchups) {
      if (m.b === null) continue;
      const a = table.get(m.a);
      const b = table.get(m.b);
      if (!a || !b) continue;
      a.pointsFor += m.aPoints;
      b.pointsFor += m.bPoints;
      if (m.winner === m.a) {
        a.wins++;
        b.losses++;
      } else if (m.winner === m.b) {
        b.wins++;
        a.losses++;
      } else {
        a.ties++;
        b.ties++;
      }
    }
  }
  const draftSeat = new Map(managers.map((id, i) => [id, i]));
  const record = (s: Standing) => s.wins + s.ties / 2;
  return [...table.values()].sort(
    (x, y) =>
      record(y) - record(x) ||
      x.losses - y.losses ||
      y.pointsFor - x.pointsFor ||
      draftSeat.get(x.managerId)! - draftSeat.get(y.managerId)!,
  );
}

/**
 * The whole season. `managers` is the league's draft order, which never changes,
 * so the round robin is stable. `points(week, manager)` is the manager's total
 * for that week; `closedWeeks` are the weeks whose every series is final.
 */
export function buildSchedule(input: {
  managers: string[];
  totalWeeks: number;
  closedWeeks: Set<number>;
  points: (week: number, managerId: string) => number;
}): Schedule {
  const { managers, totalWeeks, closedWeeks, points } = input;
  const playoffWeeks = playoffWeekCount(totalWeeks, managers.length);
  const regularWeeks = totalWeeks - playoffWeeks;
  const weeks: ScheduleWeek[] = [];

  for (let week = 1; week <= regularWeeks; week++) {
    const closed = closedWeeks.has(week);
    weeks.push({
      week,
      kind: "regular",
      closed,
      pending: false,
      matchups: roundRobinWeek(managers, week - 1).map((p) =>
        decide(p, points(week, p.a), p.b === null ? 0 : points(week, p.b), closed),
      ),
    });
  }

  const standings = standingsFrom(managers, weeks);
  const regularDone = weeks.every((w) => w.closed);
  const seed = new Map(standings.map((s, i) => [s.managerId, i]));
  const higherSeed = (x: string, y: string) => (seed.get(x)! <= seed.get(y)! ? x : y);
  let champion: string | null = null;

  const playoffWeek = (week: number, kind: WeekKind, pairs: Pairing[] | null): ScheduleWeek => {
    const closed = closedWeeks.has(week);
    if (!pairs) return { week, kind, closed, pending: true, matchups: [] };
    return {
      week,
      kind,
      closed,
      pending: false,
      matchups: pairs.map((p) => decide(p, points(week, p.a), points(week, p.b!), closed, higherSeed(p.a, p.b!))),
    };
  };

  if (playoffWeeks === 2) {
    const semiWeek = regularWeeks + 1;
    const [s1, s2, s3, s4] = standings.map((s) => s.managerId);
    const semis = playoffWeek(semiWeek, "semifinal", regularDone ? [{ a: s1, b: s4 }, { a: s2, b: s3 }] : null);
    weeks.push(semis);
    const semisDone = !semis.pending && semis.closed;
    const final = playoffWeek(
      semiWeek + 1,
      "final",
      semisDone ? [{ a: semis.matchups[0].winner!, b: semis.matchups[1].winner! }] : null,
    );
    weeks.push(final);
    if (!final.pending && final.closed) champion = final.matchups[0].winner;
  } else if (playoffWeeks === 1) {
    const [s1, s2] = standings.map((s) => s.managerId);
    const final = playoffWeek(regularWeeks + 1, "final", regularDone ? [{ a: s1, b: s2 }] : null);
    weeks.push(final);
    if (!final.pending && final.closed) champion = final.matchups[0].winner;
  }

  return { weeks, standings, champion };
}

/** The earliest week still open, or the last week once the season is over. */
export function currentWeek(weeks: ScheduleWeek[]): number | null {
  if (!weeks.length) return null;
  return (weeks.find((w) => !w.closed) ?? weeks[weeks.length - 1]).week;
}

/**
 * A slot's spread as a share of its projection, for the win chance. A guess
 * until there are scored weeks to fit it to.
 */
export const SLOT_SPREAD = 0.35;

export type SideOutlook = { banked: number; remaining: number[] };

// Abramowitz–Stegun 7.1.26, good to ~1e-7, which is far finer than a whole percent.
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * The chance side a finishes the week ahead of side b: points already banked
 * are fixed, and each slot still to play is its projection give or take
 * SLOT_SPREAD of it. A dead heat counts as half.
 */
export function winChance(a: SideOutlook, b: SideOutlook): number {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const lead = a.banked + sum(a.remaining) - b.banked - sum(b.remaining);
  const sd = Math.sqrt(sum([...a.remaining, ...b.remaining].map((p) => (SLOT_SPREAD * p) ** 2)));
  if (sd === 0) return lead > 0 ? 1 : lead < 0 ? 0 : 0.5;
  return normalCdf(lead / sd);
}

export const WEEK_KIND_LABEL: Record<WeekKind, string> = { regular: "Week", semifinal: "Semifinals", final: "Final" };

export function weekLabel(w: Pick<ScheduleWeek, "week" | "kind">): string {
  return w.kind === "regular" ? `Week ${w.week}` : WEEK_KIND_LABEL[w.kind];
}
