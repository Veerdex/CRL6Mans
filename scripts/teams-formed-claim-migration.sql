-- Run this in the Supabase SQL editor. Run it BEFORE deploying the matching
-- route change: the claim filter errors on a missing column, which stops teams
-- auto-forming until the column exists.
--
-- Claims a tournament's one-time team-formation milestone. The scheduler runs
-- every minute and the formation window stays open from draft_start_at until the
-- season starts, so without a stored claim auto-balance re-forms teams on every
-- tick. The snake draft self-guards by setting league_settings.draft_active, but
-- execAutoBalanceTeams ends with draft_active: false, leaving nothing to stop it
-- — observed re-shuffling rosters, deleting matches, re-syncing every Discord
-- team role and re-sending "Teams Generated!" once a minute for hours.
--
-- Nothing clears this column, by design: a tournament's teams are formed once,
-- and its status can never return to "scheduled" (activateTournament rejects
-- anything else), so a completed or cancelled event cannot re-enter the window.
-- Re-forming by hand from the admin dashboard calls execAutoBalanceTeams
-- directly and is unaffected by the claim.
alter table tournaments add column if not exists teams_formed_at timestamptz;

-- Backfill: any event already past its formation milestone predates the column.
-- Left unset, each would form teams one more time on the first tick after
-- deploy, which for a running tournament means a last roster re-shuffle. The
-- milestone is draft_start_at for player sign-ups and draft_close_at for
-- pre-formed teams, matching the two branches in the scheduler.
update tournaments
   set teams_formed_at = coalesce(started_at, updated_at)
 where status in ('active', 'completed', 'cancelled')
   and (case when join_mode = 'players' then draft_start_at else draft_close_at end) is not null
   and (case when join_mode = 'players' then draft_start_at else draft_close_at end) <= now();
