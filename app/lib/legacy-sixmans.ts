/**
 * The 6mans queue this server ran on a third-party bot from November 2022 until
 * our own queue bot replaced it in August 2026.
 *
 * Constants because there is nothing left to read. That bot's leaderboard API
 * serves a standings snapshot with no history dimension, and the board was
 * wiped around 8 July 2026 — it reports 25 matches and 40 players against the
 * figures below. The bot posted its last result on 2026-08-23, so the era is
 * closed and these numbers can never change again.
 *
 * Both came out of a full crawl of the archived queue and score-report channels
 * (method in the research notes, not here). `matches` is the midpoint of
 * 1,721–1,781: the high bound counts every score report, the low bound drops
 * the 60 that look like a correction re-reported rather than undone — hence the
 * leading `~` on the tile. `players` is a floor rather than a census: it counts
 * everyone who personally invoked one of the bot's commands, and only 30 more
 * people ever posted in those channels without invoking one, so the population
 * it served tops out at 304.
 *
 * Deliberately not deduped against our own bot's player count. The union is 285
 * rather than 274 + 79, but computing it needs the 274 Discord ids, and this
 * repo is public — so the panel shows each era's own figures instead.
 */
export const LEGACY_SIXMANS = {
  matches: 1750,
  players: 274,
  firstYear: 2022,
  lastYear: 2026,
} as const;
