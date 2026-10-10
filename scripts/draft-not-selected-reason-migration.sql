-- Run this in the Supabase SQL editor.
-- Holds the one-time explanation shown to a player who entered the draft pool
-- but didn't make the cutoff. Stored as the finished sentence rather than a
-- boolean because the numbers that explain the cut (pool size, team size, team
-- count) live in league_settings, which has already reset to the league default
-- by the time the player next opens the dashboard.
alter table players add column if not exists draft_not_selected_reason text;

-- No backfill: nobody who was cut before this existed is owed a notice, and the
-- column is cleared on read anyway.
