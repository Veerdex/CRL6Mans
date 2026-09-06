-- Run this in the Supabase SQL editor.
--
-- matches.score_submitted_by_team_id was declared twice with different delete rules:
-- schema.sql has `on delete set null`, score-confirmation-migration.sql has no rule at
-- all. `add column if not exists` is first-writer-wins, so which one is live depends on
-- migration run order. If the rule-less version won, `/admin disconnect` fails outright
-- the moment any match carries a captain-submitted score, because it deletes every team.
--
-- Re-declaring the constraint makes the answer deterministic. It is a no-op if the
-- column already has `on delete set null`.

alter table matches
  drop constraint if exists matches_score_submitted_by_team_id_fkey;

alter table matches
  add constraint matches_score_submitted_by_team_id_fkey
  foreign key (score_submitted_by_team_id) references teams(id) on delete set null;
