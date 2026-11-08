-- ─────────────────────────────────────────────────────────────────────────────
-- SEEDED RV ADJUSTMENTS
--
-- RV adjustments worked out from a season played before the site tracked
-- stats (the Summer 2026 replays), for players who have no Tier 3 `players`
-- row yet and so have nowhere to keep one. Keyed on discord_id with no foreign
-- key, like seeded_player_stats: a row for someone who never signs up simply
-- waits. approvePlayerWithEdits copies it onto the new players row and deletes it.
--
-- Safe to run against a live DB: additive only.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists seeded_rv_adjustments (
  discord_id       text             primary key,
  rv_adjustment    double precision not null,
  rv_series_played smallint         not null,
  source           text             not null,
  created_at       timestamptz      not null default now()
);

alter table seeded_rv_adjustments enable row level security;
