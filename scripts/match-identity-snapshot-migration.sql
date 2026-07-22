-- Run this in the Supabase SQL editor to add the match-time identity
-- snapshot table (Step 5 of the "Platform-Account Identity Enforcement" plan).
--
-- At the first replay processed for a match, freeze the roster/eligibility
-- picture (team assignments + approved subs) and a kickoff_at reference time.
-- Account verification status is deliberately NOT frozen here: accounts are
-- never hard-deleted and carry verified_at/revoked_at/valid_from, so "verified
-- and active as of kickoff_at" is a pure function the Step 6 resolver can
-- compute on demand against this kickoff_at. Freezing it here would risk
-- capturing the wrong set (e.g. dropping an account that was valid at
-- kickoff but revoked before the replay was analyzed).
--
-- kickoff_at is matches.scheduled_at when set, else the time this snapshot
-- row was first created. It is never derived from the replay's own embedded
-- Date header — that field reflects the uploader's local system clock, is
-- attacker-controllable (a re-saved or edited replay could carry any date),
-- and has no recorded timezone, so it cannot be trusted for a security-
-- relevant cutoff.
--
-- No exact pre-kickoff lineup submission UI exists in this codebase, so
-- lineup_mode is fixed to 'eligible_roster': the analyzer certifies that
-- eligible roster members played, not that a predeclared six-player lineup
-- played. roster_json captures each side's approved roster player_ids plus
-- any sub_requests approved for this match_id at snapshot time.

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

-- Idempotent creation: exactly one snapshot per match, frozen on first write.
create unique index if not exists match_identity_snapshots_match_id_idx
  on match_identity_snapshots(match_id);

alter table match_identity_snapshots disable row level security;
