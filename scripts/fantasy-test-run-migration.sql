-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — test runs (docs/fantasy-rl.md §14)
--
-- Marks a fantasy season whose drafts were started during a test event, so the
-- reset that ends the test can undo them: picks, rosters and frozen tiers are
-- deleted, the leagues go back to pre_draft and the season back to open.
-- Stored rather than inferred at reset time, since resetSeason clears
-- is_test_season itself. Additive only, safe on a live DB.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fantasy_seasons add column if not exists test_run boolean not null default false;
