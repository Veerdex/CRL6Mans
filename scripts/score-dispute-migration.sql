-- ─────────────────────────────────────────────
-- SCORE DISPUTES — reject, then escalate.
--
-- Staff used to be pushed on every series submission, which is the routine
-- case: the opponent confirms it, or processExpiredScoreConfirmations
-- auto-finalises it within 5-15 minutes. That push is gone. Staff are now
-- pulled in only when the two teams genuinely disagree:
--
--   Team A submits a score.
--   Team B rejects it        -> no staff notification. Both sides start over.
--   Team A disputes          -> staff notified, reporting frozen until they rule.
--
-- A rejection on its own stays between the teams, because the common cause is a
-- typo and the fix is a resubmission. It is the second round that means the
-- teams cannot agree by themselves.
--
-- Safe to run against a live DB, and safe to re-run: additive columns only, no
-- backfill, every default leaving existing matches in the "nothing rejected,
-- nothing disputed" state they are already in.
-- ─────────────────────────────────────────────

-- The team that rejected, and when. `score_rejected_by_team_id` is the whole
-- basis of who may dispute: the disputing team is the *other* team in the
-- match, so the submitter does not need its own column.
--
-- ON DELETE SET NULL to match matches.score_submitted_by_team_id (see
-- score-submitted-fk-fix.sql, where that FK's delete rule was settled). A
-- deleted team leaves the rejection timestamped but unattributed, which no
-- longer gates anything, rather than taking the match row with it.
alter table matches
  add column if not exists score_rejected_by_team_id uuid references teams(id) on delete set null;

alter table matches
  add column if not exists score_rejected_at timestamptz;

-- The claim that was rejected, kept so staff can see what the disagreement is
-- actually about once it reaches them.
--
-- These are deliberately NOT pending_home_score/pending_away_score. A rejection
-- clears the pending fields, and it has to: processExpiredScoreConfirmations
-- auto-finalises any pending score whose confirmation window has lapsed, so a
-- rejected claim left sitting in pending_* would be adopted as the official
-- result 5-15 minutes later — exactly the outcome a rejection exists to prevent.
alter table matches
  add column if not exists score_rejected_home integer;

alter table matches
  add column if not exists score_rejected_away integer;

-- Set when the rejected team escalates. Non-null means staff own this match:
-- the UI stops offering submit/confirm to either team, and the admin reporter is
-- the only way it gets a result.
alter table matches
  add column if not exists score_disputed_at timestamptz;

-- Partial, because disputes are rare and this index exists for one query: the
-- admin panel's list of matches awaiting a ruling.
create index if not exists matches_score_disputed_idx
  on matches(score_disputed_at)
  where score_disputed_at is not null;

-- Already true in production; stated here so re-running this file cannot leave
-- the table in a weaker posture than it found it. See scripts/rls-posture.sql.
alter table matches enable row level security;
