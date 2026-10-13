-- ─────────────────────────────────────────────
-- FORFEIT VOTES
--
-- A team gives a match up from My Team or with /forfeit, and it takes two
-- players to do it: forfeiting ends the match for the whole roster, refunds
-- every bet on it and advances the bracket, so one misclick must not be enough.
-- A 1v1 team is one player and needs one vote; see forfeitVotesRequired in
-- app/lib/forfeit-vote.ts for the roster-shrunk case.
--
-- One row per (match, player), which is what makes a repeat press idempotent
-- rather than a second vote: the primary key is the dedupe, so two players are
-- genuinely two accounts. The row records team_id for the audit trail only —
-- the count is taken against the team's *current* roster, so a player who has
-- since been moved or kicked stops counting.
--
-- Rows are left behind once the match is decided: they are inert on a completed
-- match and they are the record of who gave it up. The cascade on match_id
-- clears them with the event reset.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT GOES WITH IT. Until the table exists
-- the Forfeit button and /forfeit both fail at the vote write, which is a
-- refusal rather than a wrong result — and My Team's vote read is best-effort,
-- so the page itself keeps working either side of this migration.
-- ─────────────────────────────────────────────

create table if not exists match_forfeit_votes (
  match_id   uuid        not null references matches(id) on delete cascade,
  player_id  uuid        not null references players(id) on delete cascade,
  team_id    uuid        not null references teams(id)   on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index if not exists match_forfeit_votes_match_team_idx on match_forfeit_votes(match_id, team_id);

-- RLS on with no policies, which denies anon and authenticated outright while
-- service_role bypasses it -- and every app read and write here goes through
-- supabaseAdmin (service role), so nothing in the app notices. Load-bearing on
-- this table in particular: the anon key ships in the browser bundle, and one
-- forged row beside one real press is a forfeit.
alter table match_forfeit_votes enable row level security;
