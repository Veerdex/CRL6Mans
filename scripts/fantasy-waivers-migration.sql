-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — waivers and free agency (docs/fantasy-rl.md §9). Additive only.
--
-- fantasy_waivers        an unrostered player on waivers in one league, until
--                        clears_at (the first 4 AM Pacific run at least 24h after
--                        his series was reported or he was dropped). Playing again
--                        upserts a later clears_at, which is the "restarts the
--                        24h" rule. No row, or a past clears_at, is a free agent.
-- fantasy_waiver_claims  a manager's claim on a player on waivers, with the
--                        same-tier player he drops if it wins. One pending claim
--                        per manager per player; the daily run settles it.
-- fantasy_leagues        gains the rolling waiver order (null until the first
--                        claim moves someone, read as the reverse of the draft
--                        order) and the time its last daily run was claimed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists fantasy_waivers (
  league_id uuid        not null references fantasy_leagues(id) on delete cascade,
  player_id uuid        not null references accounts(id) on delete cascade,
  clears_at timestamptz not null,
  primary key (league_id, player_id)
);

create table if not exists fantasy_waiver_claims (
  id             uuid        primary key default gen_random_uuid(),
  league_id      uuid        not null references fantasy_leagues(id) on delete cascade,
  manager_id     uuid        not null references accounts(id) on delete cascade,
  player_id      uuid        not null references accounts(id) on delete cascade,
  drop_player_id uuid        not null references accounts(id) on delete cascade,
  status         text        not null default 'pending' check (status in ('pending', 'won', 'lost', 'failed', 'cancelled')),
  note           text,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create unique index if not exists fantasy_waiver_claims_pending_idx
  on fantasy_waiver_claims (league_id, manager_id, player_id) where status = 'pending';
create index if not exists fantasy_waiver_claims_league_idx on fantasy_waiver_claims (league_id, status);

alter table fantasy_leagues add column if not exists waiver_order   uuid[];
alter table fantasy_leagues add column if not exists waivers_ran_at timestamptz;

alter table fantasy_waivers       enable row level security;
alter table fantasy_waiver_claims enable row level security;
