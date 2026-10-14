// Rocket League competitive season boundaries. Pure, no imports — loadable by
// `node --test` like the other leaf modules.
//
// Psyonix publishes no season-calendar API, and announces an end date only a
// couple of weeks out (the in-game countdown is often the only source). Start
// dates, though, are always announced ahead of time, so a season's end is just
// the next season's start and this table only stores starts. Add a row when a
// season is announced; nothing reads past the newest entry's start date.
//
// Only Season 24's timestamp is verified against rocketleague.com. The earlier
// rows are reconstructed from third-party season tables at Psyonix's usual
// 9:00 AM PT; their exact hour doesn't matter to a day-count gate.
export type RlSeason = {
  season: number;
  /** ISO 8601, UTC. 9:00 AM PT — 16:00Z under PDT, 17:00Z under PST. */
  startedAt: string;
};

export const RL_SEASONS: RlSeason[] = [
  { season: 21, startedAt: "2025-12-10T17:00:00Z" },
  { season: 22, startedAt: "2026-03-11T16:00:00Z" },
  { season: 23, startedAt: "2026-06-10T16:00:00Z" },
  { season: 24, startedAt: "2026-09-23T16:00:00Z" }, // rocketleague.com, Season 24 announcement
];

/** Days a player has had to post a meaningful season peak before we trust one. */
export const EARLY_SEASON_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The season in progress at `now`, or null when `now` predates the table. A
 * missing newest season (nobody added the row yet) degrades to the last known
 * one rather than null, so a stale table reads as "late in the season" — the
 * permissive answer, matching the no-gate behaviour that preceded this module.
 */
export function currentRlSeason(now: Date = new Date()): RlSeason | null {
  const t = now.getTime();
  let found: RlSeason | null = null;
  for (const s of RL_SEASONS) {
    if (new Date(s.startedAt).getTime() <= t) found = s;
  }
  return found;
}

/** Whole days elapsed since the current season started; null before the table. */
export function daysIntoRlSeason(now: Date = new Date()): number | null {
  const season = currentRlSeason(now);
  if (!season) return null;
  return Math.floor((now.getTime() - new Date(season.startedAt).getTime()) / DAY_MS);
}

/**
 * Whether a self-reported season peak is too fresh to mean much. A soft reset
 * plus placements puts everyone below their real level for the first weeks, and
 * the rating model takes a power mean of season and all-time peak — so a season
 * value entered on day 2 drags the playlist's term down by roughly a third.
 */
export function isEarlyRlSeason(now: Date = new Date(), withinDays = EARLY_SEASON_DAYS): boolean {
  const days = daysIntoRlSeason(now);
  return days !== null && days < withinDays;
}
