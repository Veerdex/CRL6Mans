-- Tournaments can opt out of stat tracking: no replay uploads, no Stats tab,
-- no podium stat leaders. Seasons always track stats, so this only lives on
-- `tournaments` (mirrored into league_settings for the live runtime).
alter table tournaments     add column if not exists stats_enabled boolean not null default true;
alter table league_settings add column if not exists stats_enabled boolean not null default true;

-- player_game_stats.match_id cascades on match delete and resetSeason() deletes
-- every match, so per-game stats only ever describe the event that's currently
-- live. This table is the permanent all-time roll-up, summed out of the live
-- rows at the top of resetSeason() before they're destroyed.
create table if not exists player_career_stats (
  player_id  uuid        primary key references players(id) on delete cascade,
  games      integer     not null default 0,
  goals      integer     not null default 0,
  assists    integer     not null default 0,
  saves      integer     not null default 0,
  shots      integer     not null default 0,
  score      integer     not null default 0,
  demos      integer     not null default 0,
  demoed     integer     not null default 0,
  updated_at timestamptz not null default now()
);

alter table player_career_stats disable row level security;
