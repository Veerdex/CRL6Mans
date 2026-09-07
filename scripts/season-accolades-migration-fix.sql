-- Repairs a database that ran the first draft of season-accolades-migration.sql.
--
-- That draft keyed season_accolades on season_id with a foreign key to
-- seasons(id). The design then changed to event_id with no foreign key, because
-- every season that currently exists was backfilled by seed-past-season.mjs and
-- has no `seasons` row behind it — the FK made all of them unawardable. See the
-- comment in season-accolades-migration.sql for why those rows are absent on
-- purpose.
--
-- `create table if not exists` cannot repair a table that already exists, so
-- re-running the corrected migration is a silent no-op and every profile keeps
-- failing on "column season_accolades.event_id does not exist".

-- Refuses to run rather than discarding awards, in case this reaches a database
-- where accolades were handed out under the old shape. Migrate those by hand
-- first if it fires.
do $$
begin
  if to_regclass('public.season_accolades') is not null
     and exists (select 1 from season_accolades) then
    raise exception
      'season_accolades has rows; migrate them to event_id before running this fix';
  end if;
end $$;

drop table if exists season_accolades;

create table season_accolades (
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

create index if not exists season_accolades_discord_id_idx on season_accolades (discord_id);

-- Absent from the first draft entirely.
create table if not exists event_accolade_prizes (
  event_id uuid primary key,
  accolade_prize_mvp integer,
  accolade_prize_offensive integer,
  accolade_prize_defensive integer,
  accolade_prize_rookie integer
);
