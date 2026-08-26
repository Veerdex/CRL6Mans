-- ─────────────────────────────────────────────────────────────
-- TOURNAMENT / SEASON SPONSOR
--
-- Lets an admin attach a sponsor to a standalone tournament (picked at
-- creation, in the tournament form) or to the legacy single season (picked
-- in Season Settings). `on delete set null` so removing a sponsor never
-- blocks or cascades into tournament/season records.
-- ─────────────────────────────────────────────────────────────

alter table tournaments add column if not exists sponsor_id uuid references sponsors(id) on delete set null;
alter table league_settings add column if not exists season_sponsor_id uuid references sponsors(id) on delete set null;
