-- Frozen win-probability snapshot for the wagers "all matches" overview grid.
--
-- Unlike the live betting slip (which recomputes odds fresh from current team
-- ratings on every bet), this grid shows one fixed percentage per match that
-- should not drift as ratings change over the course of a season/tournament.
-- Nullable: populated by the tournament-scheduler cron (freezeUnfrozenMatchPredictions
-- in app/lib/match-predictions.ts) shortly after a match gets both teams assigned,
-- before it's ever played — not recomputed afterward. That cron only ever freezes
-- matches that are not yet completed, so it never captures a post-game rating.
--
-- Matches already completed as of when this ships have no such "before" moment
-- for the cron to catch, so run scripts/backfill-match-predictions.mjs --apply
-- once after this migration to reconstruct their pre-game win% via a chronological
-- rating replay (same approximation as scripts/migrate-ratings.mjs --replay).
alter table matches add column if not exists predicted_home_win_prob numeric;
alter table matches add column if not exists predicted_away_win_prob numeric;
