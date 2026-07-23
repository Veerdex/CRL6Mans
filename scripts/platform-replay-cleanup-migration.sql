-- Tracks the last time cleanupOrphanedVerificationReplays()
-- (app/lib/platform-account-cleanup.ts) swept the platform-verification-replays
-- storage bucket, via the tournament-scheduler cron. Prevents sweeping on every
-- per-minute cron tick.
alter table league_settings add column if not exists last_platform_replay_cleanup_at timestamptz;
