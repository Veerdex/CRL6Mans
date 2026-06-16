-- Run this in the Supabase SQL editor.
-- Adds multi-tournament scheduling. One tournament is "active" at a time; the
-- existing single-tournament runtime (league_settings, teams, players, matches)
-- continues to drive the active tournament. The tournaments table is the queue
-- of scheduled configs + an archive of completed-tournament summaries.

create table if not exists tournaments (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null,
  status              text        not null default 'scheduled'
                                  check (status in ('scheduled', 'active', 'completed', 'cancelled')),

  -- Configuration
  team_limit          integer     not null default 0,
  join_mode           text        not null default 'players'
                                  check (join_mode in ('teams', 'players')),
  team_assignment     text        check (team_assignment in ('snake_draft', 'auto_balance')),

  -- Schedule (all nullable; draft_* only used when there is a draft)
  draft_open_at       timestamptz,
  draft_close_at      timestamptz,
  draft_start_at      timestamptz,
  season_start_at     timestamptz,

  -- Format + scheduling config
  season_format       jsonb,
  stage_starts        jsonb,
  match_spacing_min   integer,
  match_deadline_day  integer     check (match_deadline_day between 0 and 6),
  match_play_day      integer     check (match_play_day between 0 and 6),
  match_play_hour     integer     check (match_play_hour between 0 and 23),

  -- Archive (populated on completion)
  summary             jsonb,
  started_at          timestamptz,
  ended_at            timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists tournaments_status_idx on tournaments(status);

-- Idempotent column adds for an existing tournaments table
alter table tournaments add column if not exists name               text;
alter table tournaments add column if not exists status             text        not null default 'scheduled';
alter table tournaments add column if not exists team_limit         integer     not null default 0;
alter table tournaments add column if not exists join_mode          text        not null default 'players';
alter table tournaments add column if not exists team_assignment    text;
alter table tournaments add column if not exists draft_open_at      timestamptz;
alter table tournaments add column if not exists draft_close_at     timestamptz;
alter table tournaments add column if not exists draft_start_at     timestamptz;
alter table tournaments add column if not exists season_start_at    timestamptz;
alter table tournaments add column if not exists season_format      jsonb;
alter table tournaments add column if not exists stage_starts       jsonb;
alter table tournaments add column if not exists match_spacing_min  integer;
alter table tournaments add column if not exists match_deadline_day integer;
alter table tournaments add column if not exists match_play_day     integer;
alter table tournaments add column if not exists match_play_hour    integer;
alter table tournaments add column if not exists summary            jsonb;
alter table tournaments add column if not exists started_at         timestamptz;
alter table tournaments add column if not exists ended_at           timestamptz;
alter table tournaments add column if not exists created_at         timestamptz not null default now();
alter table tournaments add column if not exists updated_at         timestamptz not null default now();
-- "Open to join" is independent of "active": multiple tournaments may have signups open.
alter table tournaments add column if not exists signups_open       boolean     not null default false;

-- Pointer from the runtime settings to the currently-active tournament
alter table league_settings add column if not exists active_tournament_id uuid references tournaments(id) on delete set null;

-- ─────────────────────────────────────────────
-- TEAM SIGN-UPS  (join_mode = 'teams' self-registration)
-- Players form teams during the registration window; at draft close the valid
-- teams (3+ accepted) are mapped onto the reusable team-slot pool.
-- ─────────────────────────────────────────────
-- Player-pool joins for join_mode='players' tournaments (multiple per player allowed).
create table if not exists tournament_entries (
  id             uuid        primary key default gen_random_uuid(),
  tournament_id  uuid        not null references tournaments(id) on delete cascade,
  player_id      uuid        not null references players(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (tournament_id, player_id)
);

create index if not exists tournament_entries_tournament_idx on tournament_entries(tournament_id);
create index if not exists tournament_entries_player_idx     on tournament_entries(player_id);

create table if not exists team_signups (
  id                 uuid        primary key default gen_random_uuid(),
  tournament_id      uuid        references tournaments(id) on delete cascade,
  creator_player_id  uuid        not null references players(id) on delete cascade,
  name               text        not null,
  formed_at          timestamptz,  -- set when the team first reaches 3 accepted members
  created_at         timestamptz not null default now()
);

create table if not exists team_signup_members (
  id              uuid        primary key default gen_random_uuid(),
  team_signup_id  uuid        not null references team_signups(id) on delete cascade,
  player_id       uuid        not null references players(id) on delete cascade,
  status          text        not null default 'invited'
                              check (status in ('invited', 'accepted')),
  invited_at      timestamptz not null default now(),
  responded_at    timestamptz,
  unique (team_signup_id, player_id)
);

create index if not exists team_signups_tournament_idx     on team_signups(tournament_id);
create index if not exists team_signup_members_team_idx     on team_signup_members(team_signup_id);
create index if not exists team_signup_members_player_idx   on team_signup_members(player_id);

-- Rely on the service-role key for all writes (consistent with the rest of the schema)
alter table tournaments         disable row level security;
alter table tournament_entries  disable row level security;
alter table team_signups        disable row level security;
alter table team_signup_members disable row level security;
