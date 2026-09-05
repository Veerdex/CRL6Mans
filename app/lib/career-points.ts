// Career points model `crl-career-points-v1`.
//
// Pure and side-effect-free — no supabase, no Discord, no "server-only" — so the
// season archiver, the profile loader, and any client-side preview all interpret
// a stored result identically. Mirrors the discipline of app/lib/rating.ts.
//
// Nothing here is ever persisted. Event results are stored as *inputs*
// (placement, team count, prize pool, kind) and points are recomputed on read,
// because the constants below are hand-tuned and will be retuned; a points value
// frozen into a row at event-completion time could never be corrected.

export const CAREER_POINTS_MODEL = "crl-career-points-v1";

// Points lost stepping from 1st to 2nd in a 20-team event. The 38 normalises the
// curve at N=20 (38 / (2*20-2) === 1), so K0 is literally dp/dr at r=1 there.
const K0 = 16.1045061696;

// log2 of this is the prize multiplier at f=0 (~0.0401), so a no-prize event
// still awards ~4% of what a 500-coin event does rather than nothing.
const PRIZE_OFFSET = 1.028185056;

const SEASON_MULTIPLIER = 2;

// The 6mans half enters the career total at half weight. season_score is on its
// own scale (100 for first) and is summed across every closed season, so at full
// weight it outgrows the event half.
const SIX_MANS_WEIGHT = 0.5;

export type EventKind = "tournament" | "season";

export type EventPointsInput = {
  /** 1-based team placement. Fractional for tied bands (3rd-4th is 3.5). */
  placement: number;
  /** N — number of *teams* in the event, not players. */
  teamCount: number;
  /** f — total prize pool in CRL coins. */
  prizePool: number;
  kind: EventKind;
};

/**
 * The prize pool a points calculation sees: 3rd-4th pays two teams, so its
 * payout counts twice.
 */
export function prizePoolTotal(
  first: number | null | undefined,
  second: number | null | undefined,
  thirdFourth: number | null | undefined,
): number {
  return (first ?? 0) + (second ?? 0) + 2 * (thirdFourth ?? 0);
}

/**
 * Raw placement score p, always spanning exactly 100 (1st) down to 1 (last)
 * whatever N is. The curve's steepness is what N changes: a < 1 is steeper than
 * a pure exponential, a > 1 gentler, with the crossover near N=36.
 */
export function placementScore(placement: number, teamCount: number): number {
  if (teamCount < 2) return 0;
  const r = clampPlacement(placement, teamCount);
  const b = (r - 1) / (teamCount - 1);
  const k = K0 * Math.pow(38 / (2 * teamCount - 2), 0.25);
  const a = (100 * Math.log(100)) / (k * (teamCount - 1));
  return Math.pow(100, 1 - b / (a + (1 - a) * b));
}

/** Field-size multiplier: winning a big event is worth more than winning a small one. */
export function scaleMultiplier(teamCount: number): number {
  if (teamCount < 2) return 0;
  return Math.log2(2 * teamCount);
}

/** Prize-pool multiplier, in CRL coins. */
export function prizeMultiplier(prizePool: number): number {
  return Math.log2(Math.max(0, prizePool) / 500 + PRIZE_OFFSET);
}

export function eventPoints(input: EventPointsInput): number {
  if (input.teamCount < 2) return 0;
  const p = placementScore(input.placement, input.teamCount);
  const kind = input.kind === "season" ? SEASON_MULTIPLIER : 1;
  return (p / 2) * scaleMultiplier(input.teamCount) * prizeMultiplier(input.prizePool) * kind;
}

/**
 * Career points = half the 6mans points + event points. The 6mans half is the
 * sum of season_score across closed queue-bot seasons, so it only moves when a
 * season closes; null means the player has never appeared in one (distinct from
 * a measured zero).
 */
export function careerPoints(
  sixMansPoints: number | null,
  events: EventPointsInput[],
): number {
  return (sixMansPoints ?? 0) * SIX_MANS_WEIGHT + events.reduce((sum, e) => sum + eventPoints(e), 0);
}

/**
 * The placement r for every team in a tied band: the midpoint of the ranks the
 * band spans. A two-team band starting at rank 3 is 3.5; an eight-team band
 * starting at 9 is 12.5. b = (r-1)/(N-1) takes the fraction as-is.
 */
export function tierPlacement(startRank: number, tierSize: number): number {
  return startRank + (tierSize - 1) / 2;
}

/**
 * Human-readable form of a placement. The midpoint alone can't recover the band
 * (12.5 is both 12th-13th and 9th-16th), so the tier size has to come with it.
 */
export function formatPlacement(placement: number, tierSize = 1): string {
  if (tierSize <= 1) return ordinal(placement);
  const start = placement - (tierSize - 1) / 2;
  return `${ordinal(start)}-${ordinal(start + tierSize - 1)}`;
}

function ordinal(n: number): string {
  const v = Math.round(n);
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

function clampPlacement(placement: number, teamCount: number): number {
  return Math.min(Math.max(placement, 1), teamCount);
}
