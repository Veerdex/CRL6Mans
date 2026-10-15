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
export const EARLY_SEASON_DAYS = 30;

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

export type EarlySeasonNotice = {
  season: number;
  /** null only when the season in progress is the oldest row in the table. */
  previousSeason: number | null;
  startedAt: string;
  daysIn: number;
};

/**
 * Set while a self-reported season peak is too fresh to mean much, null once
 * the season has run long enough to trust one. A soft reset plus placements
 * puts everyone below their real level for the first weeks, and the rating
 * model takes a power mean of season and all-time peak — so a season value
 * entered on day 2 drags that playlist's term down by roughly a third.
 *
 * While it is set, the MMR surfaces ask for the *previous* season's peaks
 * instead. They still store them in `current_*`: the column means "the season
 * peak we rate you on", and for these few weeks that is last season's.
 */
export function earlySeasonNotice(
  now: Date = new Date(),
  withinDays = EARLY_SEASON_DAYS,
): EarlySeasonNotice | null {
  const season = currentRlSeason(now);
  const daysIn = daysIntoRlSeason(now);
  if (!season || daysIn === null || daysIn >= withinDays) return null;

  const index = RL_SEASONS.indexOf(season);
  return {
    season: season.season,
    previousSeason: index > 0 ? RL_SEASONS[index - 1].season : null,
    startedAt: season.startedAt,
    daysIn,
  };
}

/** "Last Season Peak 3v3" while the notice is set, "Season Peak 3v3" otherwise. */
export function seasonPeakLabel(playlist: "2v2" | "3v3", early: boolean): string {
  return `${early ? "Last Season Peak" : "Season Peak"} ${playlist}`;
}

/** One sentence, shared verbatim by every surface that collects MMR. */
export function earlySeasonPrompt(notice: EarlySeasonNotice): string {
  const last = notice.previousSeason ? `Season ${notice.previousSeason}` : "last season";
  const when =
    notice.daysIn === 0 ? "today" : notice.daysIn === 1 ? "yesterday" : `${notice.daysIn} days ago`;
  // Names the boxes: the note sits above all four, and a player who read it as
  // covering All Time Peak too would lower `peak_*` to last season's number.
  return (
    `Rocket League Season ${notice.season} started ${when}, so this season's ranks are still` +
    ` settling after the reset. Put your ${last} peaks in the Last Season Peak boxes —` +
    ` All Time Peak is still your all-time best.`
  );
}
