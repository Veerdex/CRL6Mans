-- Run this in the Supabase SQL editor to add discrepancy persistence and the
-- hard-blocking whole-match certification gate (Step 7 of the "Platform-
-- Account Identity Enforcement" plan).
--
-- identity_enforcement_enabled defaults to false: with zero verified platform
-- accounts live yet (player_platform_accounts backfill/claim UI not shipped),
-- turning the gate on immediately would send every match to review_required
-- with no Step 8 admin override to clear it, halting match completion
-- league-wide. Persistence (certifications + discrepancies) runs unconditionally
-- so there's real shadow data to look at before the toggle is ever flipped on.
alter table league_settings add column if not exists identity_enforcement_enabled boolean not null default false;

alter table matches add column if not exists identity_status text not null default 'pending'
  check (identity_status in ('pending', 'certified', 'review_required', 'rejected'));

-- One row per analyzed replay (keyed by the content-derived replay_id, never
-- the client-supplied game_number — game_number is spoofable and must not be
-- trusted as a certification key). Recomputed via upsert on every re-analysis,
-- so an admin's aka-corrected re-upload naturally supersedes a prior verdict.
--
-- stats_json is the server-persisted, resolver-checked stats for this replay.
-- Once identity_enforcement_enabled is on, submission reads stats from here
-- instead of trusting the client's payload, so a modified client can't submit
-- different numbers under an honestly-certified replay_id.
create table if not exists replay_identity_certifications (
  id             uuid        primary key default gen_random_uuid(),
  replay_id      text        not null,
  match_id       uuid        not null references matches(id) on delete cascade,
  game_number    integer     not null,
  certified      boolean     not null,
  reason         text,
  home_team_won  boolean,
  stats_json     jsonb       not null,
  evaluated_at   timestamptz not null default now()
);

create unique index if not exists replay_identity_certifications_replay_id_idx
  on replay_identity_certifications(replay_id);
create index if not exists replay_identity_certifications_match_id_idx
  on replay_identity_certifications(match_id);

-- Per-player evidence explaining why a replay did not certify. Populated only
-- for the eligible_roster mode's real anomalies (unexpected account, wrong
-- team, duplicate, etc.) — a roster member simply not playing a given game is
-- expected under eligible_roster mode and never becomes a discrepancy row.
create table if not exists replay_identity_discrepancies (
  id                          uuid        primary key default gen_random_uuid(),
  match_id                    uuid        not null references matches(id) on delete cascade,
  replay_id                   text,
  game_number                 integer,
  replay_player_name          text,
  replay_team                 smallint,
  replay_platform             text,
  replay_platform_account_id  text,
  identity_source             text,
  expected_player_id          uuid        references players(id) on delete set null,
  expected_platform_account_id text,
  conflicting_player_id       uuid        references players(id) on delete set null,
  reason                      text        not null,
  status                      text        not null default 'open'
                                          check (status in ('open', 'resolved')),
  evidence_json               jsonb,
  resolved_by                 text,
  resolution                  text,
  admin_reason                text,
  resolved_at                 timestamptz,
  created_at                  timestamptz not null default now()
);

create index if not exists replay_identity_discrepancies_match_id_idx  on replay_identity_discrepancies(match_id);
create index if not exists replay_identity_discrepancies_replay_id_idx on replay_identity_discrepancies(replay_id);
create index if not exists replay_identity_discrepancies_status_idx    on replay_identity_discrepancies(status);

alter table replay_identity_certifications disable row level security;
alter table replay_identity_discrepancies  disable row level security;
