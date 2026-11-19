-- Season sign-ups get their own list, separate from players.draft_entered.
-- Applied to production 2026-11-18.
--
-- draft_entered is the live pool for whichever event is running, and a
-- tournament's activation overwrites it. season_entries is the season's own
-- list, so a tournament running in the meantime no longer wipes it. See
-- app/lib/season-pool.ts.
--
-- No backfill: season sign-ups were closed and nobody was entered when this ran.

create table season_entries (
  player_id  uuid primary key references players(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table season_entries enable row level security;
