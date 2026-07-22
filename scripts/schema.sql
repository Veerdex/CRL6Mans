-- CRL6Mans complete database schema
-- Run this in the Supabase SQL editor on a fresh project.
-- Fully idempotent — safe to re-run on an existing database.

-- ─────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- TEAMS
-- (created before players so the FK can reference it)
-- ─────────────────────────────────────────────
create table if not exists teams (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null,
  discord_role_id  text,
  slot_number      integer,
  wins             integer     not null default 0,
  losses           integer     not null default 0,
  is_locked        boolean     not null default false,
  logo_url         text,
  logo_offset_x    integer     not null default 50,
  logo_offset_y    integer     not null default 50
);

alter table teams add column if not exists discord_role_id  text;
alter table teams add column if not exists slot_number      integer;
alter table teams add column if not exists wins             integer not null default 0;
alter table teams add column if not exists losses           integer not null default 0;
alter table teams add column if not exists is_locked        boolean not null default false;
alter table teams add column if not exists logo_url         text;
alter table teams add column if not exists logo_offset_x    integer not null default 50;
alter table teams add column if not exists logo_offset_y    integer not null default 50;

-- ─────────────────────────────────────────────
-- PLAYERS
-- ─────────────────────────────────────────────
create table if not exists players (
  id                  uuid        primary key default gen_random_uuid(),
  discord_id          text        not null unique,
  username            text        not null,
  avatar              text,
  status              text        not null default 'pending'
                                  check (status in ('pending', 'approved', 'rejected')),
  peak_3v3            text        not null default '0',
  current_3v3         text        not null default '0',
  peak_2v2            text        not null default '0',
  current_2v2         text        not null default '0',
  tracker_url         text        not null default '',
  college_image_url   text        not null default '',
  draft_entered       boolean     not null default false,
  draft_entered_at    timestamptz,
  tracker_confirmed_at timestamptz,
  in_active_draft     boolean     not null default false,
  team_id             uuid        references teams(id) on delete set null,
  is_captain          boolean     not null default false,
  sub_willing         boolean     not null default false,
  ban_reason          text,
  kick_reason         text,
  theme               text        not null default 'crl6mans'
                                  check (theme in ('light', 'dark', 'crl6mans')),
  nav_layout          text        not null default 'sidebar'
                                  check (nav_layout in ('sidebar', 'topbar')),
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists players_team_id_idx    on players(team_id);
create index if not exists players_status_idx     on players(status);
create index if not exists players_discord_id_idx on players(discord_id);

alter table players add column if not exists avatar             text;
alter table players add column if not exists peak_3v3           text not null default '0';
alter table players add column if not exists current_3v3        text not null default '0';
alter table players add column if not exists peak_2v2           text not null default '0';
alter table players add column if not exists current_2v2        text not null default '0';
alter table players add column if not exists tracker_url        text not null default '';
alter table players add column if not exists college_image_url  text not null default '';
alter table players add column if not exists draft_entered      boolean not null default false;
alter table players add column if not exists draft_entered_at   timestamptz;
alter table players add column if not exists tracker_confirmed_at timestamptz;
alter table players add column if not exists must_update_tracker boolean not null default false;
alter table players add column if not exists in_active_draft    boolean not null default false;
alter table players add column if not exists team_id            uuid references teams(id) on delete set null;
alter table players add column if not exists is_captain         boolean not null default false;
alter table players add column if not exists sub_willing        boolean not null default false;
alter table players add column if not exists display_name       text;
alter table players add column if not exists ban_reason         text;
alter table players add column if not exists kick_reason        text;
alter table players add column if not exists kicked_until       timestamptz;
alter table players add column if not exists theme              text not null default 'crl6mans';
alter table players add column if not exists nav_layout         text not null default 'sidebar';
alter table players add column if not exists updated_at         timestamptz not null default now();
alter table players add column if not exists created_at         timestamptz not null default now();

alter table players alter column theme set default 'crl6mans';
alter table players drop constraint if exists players_theme_check;
alter table players add constraint players_theme_check
  check (theme in ('light', 'dark', 'crl6mans'));

-- ─────────────────────────────────────────────
-- MATCHES
-- ─────────────────────────────────────────────
create table if not exists matches (
  id                            uuid        primary key default gen_random_uuid(),
  stage                         text,
  round                         integer     not null default 1,
  match_number                  integer     not null default 1,
  home_team_id                  uuid        references teams(id) on delete set null,
  away_team_id                  uuid        references teams(id) on delete set null,
  home_score                    integer,
  away_score                    integer,
  pending_home_score            integer,
  pending_away_score            integer,
  score_submitted_by_team_id    uuid        references teams(id) on delete set null,
  score_confirmed               boolean     not null default false,
  status                        text        not null default 'scheduled'
                                            check (status in ('scheduled', 'completed', 'cancelled')),
  scheduled_at                  timestamptz,
  schedule_proposed_by_team_id  uuid        references teams(id) on delete set null,
  schedule_accepted             boolean,
  week                          integer,
  discord_channel_id            text
);

create index if not exists matches_home_team_id_idx on matches(home_team_id);
create index if not exists matches_away_team_id_idx on matches(away_team_id);
create index if not exists matches_stage_idx        on matches(stage);
create index if not exists matches_status_idx       on matches(status);

alter table matches add column if not exists stage                        text;
alter table matches add column if not exists round                        integer not null default 1;
alter table matches add column if not exists match_number                 integer not null default 1;
alter table matches add column if not exists home_team_id                 uuid references teams(id) on delete set null;
alter table matches add column if not exists away_team_id                 uuid references teams(id) on delete set null;
alter table matches add column if not exists home_score                   integer;
alter table matches add column if not exists away_score                   integer;
alter table matches add column if not exists pending_home_score           integer;
alter table matches add column if not exists pending_away_score           integer;
alter table matches add column if not exists score_submitted_by_team_id   uuid references teams(id) on delete set null;
alter table matches add column if not exists score_confirmed              boolean not null default false;
alter table matches add column if not exists scheduled_at                 timestamptz;
alter table matches add column if not exists schedule_proposed_by_team_id uuid references teams(id) on delete set null;
alter table matches add column if not exists schedule_accepted            boolean;
alter table matches add column if not exists week                         integer;
alter table matches add column if not exists discord_channel_id           text;

-- ─────────────────────────────────────────────
-- MATCH DISCORD CATEGORIES
-- ─────────────────────────────────────────────
create table if not exists match_discord_categories (
  id                  uuid        primary key default gen_random_uuid(),
  discord_category_id text        not null unique,
  label               text        not null,
  stage               text        not null,
  round               integer,
  bucket              text,
  created_at          timestamptz not null default now()
);

create index if not exists mdc_stage_round_idx on match_discord_categories(stage, round);

-- ─────────────────────────────────────────────
-- PLAYER GAME STATS  (per-game replay stats)
-- ─────────────────────────────────────────────
create table if not exists player_game_stats (
  id           uuid        primary key default gen_random_uuid(),
  player_id    uuid        references players(id) on delete set null,
  match_id     uuid        references matches(id) on delete cascade,
  game_number  integer     not null default 1,
  replay_name  text,
  replay_id    text,
  goals        integer     not null default 0,
  assists      integer     not null default 0,
  saves        integer     not null default 0,
  shots        integer     not null default 0,
  score        integer     not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists player_game_stats_match_idx  on player_game_stats(match_id);
create index if not exists player_game_stats_player_idx on player_game_stats(player_id);

alter table player_game_stats add column if not exists replay_id text;
create index if not exists player_game_stats_replay_idx on player_game_stats(replay_id);

-- ─────────────────────────────────────────────
-- STAFF ROLES  (source of truth for moderator/director/ceo)
-- ─────────────────────────────────────────────
create table if not exists staff_roles (
  discord_id  text        primary key,
  role        text        not null default 'moderator'
                          check (role in ('moderator', 'director', 'ceo')),
  username    text,
  added_by    text,
  created_at  timestamptz not null default now()
);

alter table staff_roles add column if not exists username   text;
alter table staff_roles add column if not exists added_by   text;
alter table staff_roles add column if not exists created_at timestamptz not null default now();

-- ─────────────────────────────────────────────
-- ANALYTICS EVENTS  (admin Insights: visits, registrations, draft joins)
-- ─────────────────────────────────────────────
create table if not exists analytics_events (
  id         uuid        primary key default gen_random_uuid(),
  type       text        not null check (type in ('visit', 'registration', 'draft_join')),
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_type_created_idx on analytics_events(type, created_at);

-- ─────────────────────────────────────────────
-- LEAGUE SETTINGS  (always exactly one row)
-- ─────────────────────────────────────────────
create table if not exists league_settings (
  id                    uuid        primary key default gen_random_uuid(),

  draft_open            boolean     not null default false,
  draft_signups_closed  boolean     not null default false,
  draft_active          boolean     not null default false,
  season_active         boolean     not null default false,
  num_teams             integer     not null default 0,
  season_participants   integer     not null default 16,

  season_format         jsonb,

  current_pick          integer     not null default 0,
  draft_phase           text,
  nominated_player_id   uuid        references players(id) on delete set null,
  current_bid           integer,
  current_bid_team_id   uuid        references teams(id) on delete set null,
  current_bid_time      timestamptz,
  pick_deadline         timestamptz,

  draft_channel_id      text,
  match_category_id     text,
  rules_channel_id      text,
  match_deadline_day    integer     check (match_deadline_day between 0 and 6),
  match_play_day        integer     check (match_play_day between 0 and 6),
  match_play_hour       integer     check (match_play_hour between 0 and 23),
  min_mmr_2v2           integer,
  min_mmr_3v3           integer,
  admin_notification_prefs jsonb,

  updated_at            timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from league_settings) then
    insert into league_settings default values;
  end if;
end $$;

alter table league_settings add column if not exists draft_open            boolean     not null default false;
alter table league_settings add column if not exists draft_active          boolean     not null default false;
alter table league_settings add column if not exists draft_signups_closed  boolean     not null default false;
alter table league_settings add column if not exists season_active         boolean     not null default false;
alter table league_settings add column if not exists num_teams             integer     not null default 0;
alter table league_settings add column if not exists season_participants   integer     not null default 16;
alter table league_settings add column if not exists season_format         jsonb;
alter table league_settings add column if not exists current_pick          integer     not null default 0;
alter table league_settings add column if not exists draft_phase           text;
alter table league_settings add column if not exists nominated_player_id   uuid        references players(id) on delete set null;
alter table league_settings add column if not exists current_bid           integer;
alter table league_settings add column if not exists current_bid_team_id   uuid        references teams(id) on delete set null;
alter table league_settings add column if not exists current_bid_time      timestamptz;
alter table league_settings add column if not exists pick_deadline         timestamptz;
alter table league_settings add column if not exists draft_channel_id      text;
alter table league_settings add column if not exists match_category_id     text;
alter table league_settings add column if not exists rules_channel_id      text;
alter table league_settings add column if not exists match_deadline_day    integer;
alter table league_settings add column if not exists match_play_day        integer;
alter table league_settings add column if not exists match_play_hour       integer;
alter table league_settings add column if not exists min_mmr_2v2           integer;
alter table league_settings add column if not exists min_mmr_3v3           integer;
alter table league_settings add column if not exists admin_notification_prefs jsonb;
alter table league_settings add column if not exists moderator_role_id     text;
alter table league_settings add column if not exists director_role_id      text;
alter table league_settings add column if not exists ceo_role_id           text;
alter table league_settings add column if not exists updated_at            timestamptz not null default now();

-- ─────────────────────────────────────────────
-- TOURNAMENTS
-- ─────────────────────────────────────────────
create table if not exists tournaments (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null,
  status              text        not null default 'scheduled'
                                  check (status in ('scheduled', 'active', 'completed', 'cancelled')),
  team_limit          integer     not null default 0,
  min_teams           integer     not null default 0,
  join_mode           text        not null default 'players'
                                  check (join_mode in ('teams', 'players')),
  team_assignment     text        check (team_assignment in ('snake_draft', 'auto_balance')),
  signups_open        boolean     not null default false,
  signups_closed      boolean     not null default false,
  draft_open_at       timestamptz,
  draft_close_at      timestamptz,
  draft_start_at      timestamptz,
  season_start_at     timestamptz,
  season_format       jsonb,
  stage_starts        jsonb,
  match_spacing_min   integer,
  match_deadline_day  integer     check (match_deadline_day between 0 and 6),
  match_play_day      integer     check (match_play_day between 0 and 6),
  match_play_hour     integer     check (match_play_hour between 0 and 23),
  summary             jsonb,
  started_at          timestamptz,
  ended_at            timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists tournaments_status_idx on tournaments(status);

alter table tournaments add column if not exists name               text;
alter table tournaments add column if not exists status             text        not null default 'scheduled';
alter table tournaments add column if not exists team_limit         integer     not null default 0;
alter table tournaments add column if not exists min_teams          integer     not null default 0;
alter table tournaments add column if not exists join_mode          text        not null default 'players';
alter table tournaments add column if not exists team_assignment    text;
alter table tournaments add column if not exists signups_open       boolean     not null default false;
alter table tournaments add column if not exists signups_closed     boolean     not null default false;
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
alter table tournaments add column if not exists hidden_from_home   boolean     not null default false;

alter table league_settings add column if not exists active_tournament_id uuid references tournaments(id) on delete set null;

-- ─────────────────────────────────────────────
-- TOURNAMENT ENTRIES  (join_mode = 'players')
-- ─────────────────────────────────────────────
create table if not exists tournament_entries (
  id             uuid        primary key default gen_random_uuid(),
  tournament_id  uuid        not null references tournaments(id) on delete cascade,
  player_id      uuid        not null references players(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (tournament_id, player_id)
);

create index if not exists tournament_entries_tournament_idx on tournament_entries(tournament_id);
create index if not exists tournament_entries_player_idx     on tournament_entries(player_id);

-- ─────────────────────────────────────────────
-- TEAM SIGN-UPS  (join_mode = 'teams')
-- ─────────────────────────────────────────────
create table if not exists team_signups (
  id                 uuid        primary key default gen_random_uuid(),
  tournament_id      uuid        references tournaments(id) on delete cascade,
  creator_player_id  uuid        not null references players(id) on delete cascade,
  name               text        not null,
  formed_at          timestamptz,
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

create index if not exists team_signups_tournament_idx      on team_signups(tournament_id);
create index if not exists team_signup_members_team_idx     on team_signup_members(team_signup_id);
create index if not exists team_signup_members_player_idx   on team_signup_members(player_id);

-- ─────────────────────────────────────────────
-- SUB REQUESTS
-- ─────────────────────────────────────────────
create table if not exists sub_requests (
  id                       uuid        primary key default gen_random_uuid(),
  team_id                  uuid        not null references teams(id)    on delete cascade,
  match_id                 uuid                    references matches(id) on delete set null,
  player_out_id            uuid        not null references players(id)  on delete cascade,
  sub_player_id            uuid                    references players(id) on delete set null,
  reason                   text,
  status                   text        not null default 'pending'
                                       check (status in ('pending', 'approved', 'rejected', 'escalated')),
  admin_note               text,
  requested_by_discord_id  text        not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists sub_requests_team_id_idx on sub_requests(team_id);
create index if not exists sub_requests_status_idx  on sub_requests(status);

-- ─────────────────────────────────────────────
-- PLAYER EDIT REQUESTS
-- ─────────────────────────────────────────────
create table if not exists player_edit_requests (
  id           uuid        primary key default gen_random_uuid(),
  player_id    uuid        not null references players(id) on delete cascade,
  discord_id   text        not null,
  username     text        not null,
  tracker_url  text        not null,
  peak_3v3     text        not null,
  current_3v3  text        not null,
  peak_2v2     text        not null,
  current_2v2  text        not null,
  status       text        not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected')),
  admin_note   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists player_edit_requests_player_id_idx on player_edit_requests(player_id);
create index if not exists player_edit_requests_status_idx    on player_edit_requests(status);

-- ─────────────────────────────────────────────
-- PLATFORM ACCOUNTS  (replay identity verification)
-- ─────────────────────────────────────────────
create table if not exists player_platform_accounts (
  id                          uuid        primary key default gen_random_uuid(),
  player_id                   uuid        not null references players(id) on delete cascade,
  platform                    text        not null
                                          check (platform in ('steam', 'epic', 'playstation', 'xbox', 'switch', 'psynet')),
  platform_account_id         text,
  claimed_display_name        text,
  verified_display_name       text,
  claimed_tracker_url         text,
  claimed_verification_replay_path text,
  verification_status         text        not null default 'claimed'
                                          check (verification_status in
                                            ('claimed', 'pending_verification', 'verified', 'rejected', 'withdrawn', 'revoked')),
  verification_method         text        check (verification_method in
                                            ('steam_openid', 'epic_oauth', 'official_account_page',
                                             'console_replay_network', 'admin_live', 'legacy_manual')),
  verification_replay_sha256  text,
  verified_by                 text,
  verified_at                 timestamptz,
  valid_from                  timestamptz,
  valid_until                 timestamptz,
  revoked_by                  text,
  revoked_at                  timestamptz,
  admin_note                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  check (
    verification_status != 'verified'
    or (
      platform_account_id is not null
      and verification_method is not null
      and verified_by is not null
      and verified_at is not null
      and valid_from is not null
    )
  ),
  check (verification_status != 'revoked' or revoked_at is not null)
);

create index if not exists player_platform_accounts_player_id_idx on player_platform_accounts(player_id);
create index if not exists player_platform_accounts_platform_idx on player_platform_accounts(platform);
create index if not exists player_platform_accounts_status_idx   on player_platform_accounts(verification_status);

create unique index if not exists player_platform_accounts_active_id_idx
  on player_platform_accounts(platform, platform_account_id)
  where verification_status in ('claimed', 'pending_verification', 'verified')
    and platform_account_id is not null;

create table if not exists player_platform_account_events (
  id           uuid        primary key default gen_random_uuid(),
  account_id   uuid        not null references player_platform_accounts(id) on delete cascade,
  event_type   text        not null
                           check (event_type in
                             ('claimed', 'verification_submitted', 'verified', 'rejected',
                              'withdrawn', 'revoked', 'corrected', 'note_added', 'ban_evasion_flagged')),
  actor        text        not null,
  detail_json  jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists player_platform_account_events_account_idx on player_platform_account_events(account_id);
create index if not exists player_platform_account_events_type_idx    on player_platform_account_events(event_type);

-- ─────────────────────────────────────────────
-- MATCH IDENTITY SNAPSHOTS  (frozen roster/eligibility at kickoff)
-- ─────────────────────────────────────────────
create table if not exists match_identity_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  match_id        uuid        not null references matches(id) on delete cascade,
  lineup_mode     text        not null default 'eligible_roster'
                              check (lineup_mode in ('eligible_roster', 'exact_lineup')),
  kickoff_at      timestamptz not null,
  home_team_id    uuid        references teams(id) on delete set null,
  away_team_id    uuid        references teams(id) on delete set null,
  roster_json     jsonb       not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists match_identity_snapshots_match_id_idx
  on match_identity_snapshots(match_id);

-- ─────────────────────────────────────────────
-- GAME SCORES  (Flappy Bird leaderboard)
-- ─────────────────────────────────────────────
create table if not exists game_scores (
  discord_id   text        primary key,
  username     text        not null,
  score        integer     not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists game_scores_score_idx on game_scores(score desc);

-- ─────────────────────────────────────────────
-- PUSH SUBSCRIPTIONS  (Web Push / PWA notifications)
-- ─────────────────────────────────────────────
create table if not exists push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  discord_id text        not null,
  endpoint   text        not null unique,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_discord_id_idx on push_subscriptions(discord_id);

-- ─────────────────────────────────────────────
-- SEASONS (archive of completed manual seasons — mirrors tournaments.summary)
-- ─────────────────────────────────────────────
create table if not exists seasons (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  year          integer     not null,
  season_format jsonb,
  team_count    integer     not null default 0,
  summary       jsonb,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists seasons_ended_at_idx on seasons(ended_at);

alter table seasons add column if not exists hidden_from_home boolean not null default false;

-- ─────────────────────────────────────────────
-- STORAGE BUCKETS
-- Note: if the SQL editor returns an error on this block, create the buckets
-- manually in Supabase Dashboard → Storage. Both should be set to Public.
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values
  ('team-logos',  'team-logos',  true),
  ('college-ids', 'college-ids', true),
  ('platform-verification-replays', 'platform-verification-replays', false)
on conflict (id) do update set public = excluded.public;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Disabled on all tables — the app uses the service-role key exclusively.
-- ─────────────────────────────────────────────
alter table players                  disable row level security;
alter table teams                    disable row level security;
alter table matches                  disable row level security;
alter table league_settings          disable row level security;
alter table sub_requests             disable row level security;
alter table game_scores              disable row level security;
alter table tournaments              disable row level security;
alter table tournament_entries       disable row level security;
alter table team_signups             disable row level security;
alter table team_signup_members      disable row level security;
alter table player_edit_requests     disable row level security;
alter table match_discord_categories disable row level security;
alter table player_game_stats        disable row level security;
alter table push_subscriptions       disable row level security;
alter table seasons                  disable row level security;
alter table analytics_events         disable row level security;
alter table player_platform_accounts       disable row level security;
alter table player_platform_account_events disable row level security;
alter table match_identity_snapshots       disable row level security;
