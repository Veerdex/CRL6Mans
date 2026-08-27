-- Run this in the Supabase SQL editor.
--
-- Adds per-clip expiry so a clip's guaranteed minimum lifetime (7 days) no
-- longer depends on what day of the week it was submitted. Previously every
-- active clip was archived at the same weekly boundary regardless of when it
-- was submitted, so a clip submitted late in the week (e.g. Saturday) could
-- last under a day. expires_at is computed once at submission time (see
-- computeClipExpiry in app/lib/clip-schedule.ts) as the end of the week AFTER
-- the one it was submitted in — e.g. a Saturday submission now survives 8
-- days, a Sunday submission survives close to 14.
--
-- The clip-reset cron archives a clip early (before its own expires_at) only
-- when it's crowned Clip of the Week, so it stops showing in the main feed
-- and only appears via the Clip of the Week slot.

alter table clips add column if not exists expires_at timestamptz;

-- Backfill already-active clips (submitted before this shipped) so they
-- don't all read as already-expired the moment the cron starts checking
-- expires_at. created_at + 14 days is an approximation — the exact
-- week-aligned boundary only matters for clips submitted going forward.
update clips
set expires_at = created_at + interval '14 days'
where expires_at is null and archived_at is null;
