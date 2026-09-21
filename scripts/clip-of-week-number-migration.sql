-- The week number a clip won Clip of the Week as ("Week 1", "Week 2", …).
--
-- A running count that never resets, stored per winning clip rather than as a
-- counter on league_settings: kept on the clip, each past winner keeps the
-- number it was crowned under forever, so a "past winners" view gets the label
-- for free and nothing drifts if a crowning is ever replayed or rolled back.
-- Null for every clip that never won, which is nearly all of them.
alter table clips add column if not exists clip_of_week_number integer;

-- The cron computes the next number as max + 1, so two clips can only collide
-- if two crownings land in the same run; the index turns that into a failed
-- write instead of a duplicate "Week 3".
create unique index if not exists clips_clip_of_week_number_idx
  on clips(clip_of_week_number)
  where clip_of_week_number is not null;

-- Backfills the clip currently sitting in the Clip of the Week slot as Week 1,
-- so the next crowning computes as Week 2 rather than restarting at 1.
--
-- Does nothing if league_settings.clip_of_week_id is null (no clip has ever
-- been crowned) — in which case the first crowning is correctly Week 1.
update clips
   set clip_of_week_number = 1
 where id = (select clip_of_week_id from league_settings limit 1)
   and clip_of_week_number is null;
