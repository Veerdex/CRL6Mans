-- Run this in the Supabase SQL editor.
-- Adds captain-submitted pending scores and cross-captain confirmation to matches.

alter table matches
  add column if not exists pending_home_score        integer,
  add column if not exists pending_away_score        integer,
  add column if not exists score_submitted_by_team_id uuid references teams(id),
  add column if not exists score_confirmed           boolean not null default false;
