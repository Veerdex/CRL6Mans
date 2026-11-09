-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — sent log for derived notices (docs/fantasy-rl.md §12). Additive only.
--
-- fantasy_notices  one row per notice a league has sent, keyed by what it was
--                  about: result:{week}, seeding, lineup:{week}:{manager}:
--                  {player}:{reason}, plus a baseline row written on the first
--                  sweep so what was already due at deploy is marked, not sent.
--                  app/lib/fantasy-notices-server.ts inserts with on conflict
--                  do nothing and sends only the rows it inserted, so two
--                  overlapping cron ticks can't both send.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists fantasy_notices (
  league_id  uuid        not null references fantasy_leagues(id) on delete cascade,
  key        text        not null,
  created_at timestamptz not null default now(),
  primary key (league_id, key)
);

alter table fantasy_notices enable row level security;
