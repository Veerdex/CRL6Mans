-- Run this in the Supabase SQL editor.
-- Marks that a tournament's "starts soon" reminder has gone out. The scheduler
-- runs every minute and the reminder window is 24 hours wide, so without a
-- stored claim the same reminder would fire roughly 1440 times.
alter table tournaments add column if not exists reminder_24h_sent_at timestamptz;

-- Backfill: every tournament already inside (or past) its 24h window predates
-- the feature, and nobody is owed a reminder for it. Left unset, all of them
-- would fire on the first tick after deploy.
update tournaments
   set reminder_24h_sent_at = now()
 where season_start_at is not null
   and season_start_at <= now() + interval '24 hours';
