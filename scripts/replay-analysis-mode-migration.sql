-- Loose / strict replay analysis.
--
-- Replaces identity_enforcement_enabled as the gate on replay submission.
-- Certification keeps running and keeps filling replay_identity_discrepancies,
-- but it no longer blocks anything on its own -- the mode below decides.

alter table league_settings
  add column if not exists replay_analysis_mode text not null default 'loose'
  check (replay_analysis_mode in ('loose', 'strict'));

-- Separate from matches.identity_status, whose four values are tied to
-- platform-identity certification. This tracks the admin-review leg of the
-- new submit -> opponent accepts -> admin flow.
alter table matches
  add column if not exists replay_review_status text not null default 'none'
  check (replay_review_status in ('none', 'pending_admin', 'rejected'));

-- Replay player names that resolved to no registered player. Non-empty means
-- the game is "bad": amber warning on loose, admin review on strict.
alter table replay_identity_certifications
  add column if not exists unmatched_names text[];

create index if not exists matches_replay_review_status_idx
  on matches(replay_review_status)
  where replay_review_status <> 'none';
