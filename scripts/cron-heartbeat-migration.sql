-- Cron heartbeats: each cron route stamps its column immediately after the auth
-- check, so the admin dashboard can tell whether the external per-minute pinger
-- (cron-job.org) is actually reaching us.
--
-- These record an AUTHENTICATED INVOCATION, not a successful completion. A 401
-- returns before the handler body and writes nothing, which is what makes a dead
-- or misconfigured pinger visible — but a job that runs and then throws still
-- stamps its column, so a green row means "we were pinged", not "it worked".
--
-- Vercel's own daily crons in vercel.json sign their requests with CRON_SECRET
-- and pass the same guard, so they stamp these too. A row whose timestamp is
-- hours old is the signature of a dead pinger with the Vercel fallback still
-- running, rather than nothing running at all.
--
-- patreon-sync is deliberately excluded: its route comment marks it daily-only
-- and off the per-minute pinger list.

alter table league_settings
  add column if not exists cron_scheduler_last_run_at timestamptz,
  add column if not exists cron_autopick_last_run_at  timestamptz,
  add column if not exists cron_clipreset_last_run_at timestamptz;
