-- Hand-awarded season accolades: MVP, Offensive/Defensive Player Of The Year,
-- Rookie Of The Year. One holder per accolade per season, assigned by a
-- Director+ from a player's Event History.
--
-- Deliberately NOT part of player_event_results: that table is a derived index
-- regenerated wholesale by rebuildEventResults(), so an award written there
-- would be erased the next time the placement or points logic changed. An
-- accolade is not derivable from an archive, so it needs its own row.

-- Values for the season currently being run, alongside season_prize_*.
alter table league_settings add column if not exists accolade_prize_mvp integer;
alter table league_settings add column if not exists accolade_prize_offensive integer;
alter table league_settings add column if not exists accolade_prize_defensive integer;
alter table league_settings add column if not exists accolade_prize_rookie integer;

-- Snapshotted onto the season at completion, and editable afterwards: the four
-- backfilled seasons were written by a script with no such field, so their
-- values can only ever be filled in after the fact.
alter table seasons add column if not exists accolade_prize_mvp integer;
alter table seasons add column if not exists accolade_prize_offensive integer;
alter table seasons add column if not exists accolade_prize_defensive integer;
alter table seasons add column if not exists accolade_prize_rookie integer;

create table if not exists season_accolades (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  accolade text not null check (accolade in ('mvp', 'offensive', 'defensive', 'rookie')),
  discord_id text not null,
  awarded_by text,
  created_at timestamptz not null default now(),
  -- One holder per accolade per season. Awarding to someone new deletes the
  -- incumbent's row first rather than relying on this to arbitrate.
  unique (season_id, accolade)
);

-- Profiles look accolades up by player, not by season.
create index if not exists season_accolades_discord_id_idx on season_accolades (discord_id);
