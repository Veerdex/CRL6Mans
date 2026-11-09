-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — an owner leaving always passes the league on (docs/fantasy-rl.md §2, §11).
--
-- The one-league rule was a unique key on (season, created_by). A league is no
-- longer deleted when its creator leaves, so that key would stop the creator
-- from ever creating another. The rule is now "own one league per season",
-- checked by ownsLeague in app/lib/fantasy-leagues.ts. It can't be a unique
-- index on commissioner_id: an heir may already own a league of their own.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fantasy_leagues drop constraint if exists fantasy_leagues_fantasy_season_id_created_by_key;
