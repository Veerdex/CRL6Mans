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

-- Keyed on event_id, not seasons(id), and with no foreign key — the same key
-- space player_event_results uses. Every season that currently exists was
-- backfilled by scripts/seed-past-season.mjs, which writes an event_id with no
-- `seasons` row behind it on purpose: those events predate the site and have no
-- matches or stats, so a hand-authored parent row would show up as an empty
-- season on the home page, the podium and the admin season list, and
-- /wipe clear_history would delete it. A foreign key here would make every one
-- of them unawardable.
create table if not exists event_accolade_prizes (
  event_id uuid primary key,
  accolade_prize_mvp integer,
  accolade_prize_offensive integer,
  accolade_prize_defensive integer,
  accolade_prize_rookie integer
);

-- Written at completion from the live league_settings values, and editable
-- afterwards: the backfilled seasons have nothing to snapshot from, so their
-- values can only ever be filled in after the fact.
create table if not exists season_accolades (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  accolade text not null check (accolade in ('mvp', 'offensive', 'defensive', 'rookie')),
  discord_id text not null,
  awarded_by text,
  created_at timestamptz not null default now(),
  -- One holder per accolade per season. Awarding to someone new deletes the
  -- incumbent's row first rather than relying on this to arbitrate.
  unique (event_id, accolade)
);

-- Profiles look accolades up by player, not by season.
create index if not exists season_accolades_discord_id_idx on season_accolades (discord_id);
