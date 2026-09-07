-- Per-player scoreboard totals for an event that finished before the site
-- existed. Run manually in the Supabase SQL editor.
--
-- Keyed on discord_id with NO foreign key, the same key space
-- player_event_results uses and for the same reason: a player who has never
-- logged in has no accounts row and no players.id, so a row keyed on either
-- could not be written until after they joined — which is exactly when nobody
-- is around to write it. fetchAllTimeTotals() resolves discord_id -> players.id
-- at read time instead, so seeded totals sit here indefinitely and appear the
-- moment that Discord account is approved.
--
-- Deliberately NOT merged into player_career_stats. That table is accumulated
-- additively by rollUpCareerStats(), so re-seeding a season would double every
-- number in it. Keying per (event_id, discord_id) makes a re-run an upsert that
-- replaces, and keeps the provenance of each figure.
--
-- games is the divisor behind MVP and every per-game column. A row seeded with
-- games = 0 but nonzero goals would attribute those goals to whatever games the
-- player later plays live, so the seeder refuses to write one.

create table if not exists seeded_player_stats (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null,
  discord_id text not null,
  -- The roster name from the placement file, for reading this table by hand.
  -- Nothing renders it; the leaderboard shows the account's own name.
  display_name text,

  games integer not null default 0,
  goals integer not null default 0,
  assists integer not null default 0,
  saves integer not null default 0,
  shots integer not null default 0,
  score integer not null default 0,
  demos integer not null default 0,
  demoed integer not null default 0,

  updated_at timestamptz not null default now(),

  unique (event_id, discord_id)
);

-- The read path scans every row and resolves by account, so the lookup is on
-- discord_id rather than event_id.
create index if not exists seeded_player_stats_discord_id_idx
  on seeded_player_stats (discord_id);
