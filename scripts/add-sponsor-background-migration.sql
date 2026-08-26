-- ─────────────────────────────────────────────────────────────
-- SPONSOR TOURNAMENT-CARD BACKGROUND
--
-- Optional image a sponsor can provide to be used as the background of a
-- tournament's card on the Upcoming Tournaments home page list, when that
-- tournament has the sponsor attached (tournaments.sponsor_id). Falls back
-- to the card's normal background when unset.
-- ─────────────────────────────────────────────────────────────

alter table sponsors add column if not exists background_image_url text;
