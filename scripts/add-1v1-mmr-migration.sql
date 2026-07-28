-- ─────────────────────────────────────────────────────────────
-- 1v1 MMR COLUMNS — additive migration
--
-- Adds all-time-peak and season-peak 1v1 MMR fields alongside the existing
-- 2v2/3v3 fields, needed by the new player-rating algorithm (app/lib/rating.ts).
--
-- Unlike peak_2v2/peak_3v3 (which are `text not null default '0'`), these
-- columns are left NULLABLE with NO DEFAULT on purpose: NULL is the only way
-- to distinguish "never submitted 1v1 data" from "submitted 0", and the app
-- gates draft entry on that distinction (enterDraft blocks a player whose
-- peak_1v1/current_1v1 is null until they submit a profile-edit request).
-- A `'0'` default would make every backfilled/existing player indistinguishable
-- from someone who legitimately entered 0.
--
-- Safe to run against a live DB with existing rows — no NOT NULL is added,
-- so no backfill value is required for this migration to succeed.
-- ─────────────────────────────────────────────────────────────

alter table pending_players add column if not exists peak_1v1    text;
alter table pending_players add column if not exists current_1v1 text;

alter table players add column if not exists peak_1v1    text;
alter table players add column if not exists current_1v1 text;

alter table player_edit_requests add column if not exists peak_1v1    text;
alter table player_edit_requests add column if not exists current_1v1 text;
