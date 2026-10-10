-- Stamps the moment a match actually went live: the instant the second of the two
-- teams checked in, which is also the instant createChannelIfCheckedIn opens the
-- match's Discord channel.
--
-- Nothing recorded this before. home_checked_in / away_checked_in are plain
-- booleans and checkin_deadline is the *end* of the 10-minute window, so the only
-- surviving trace of a real start time was the Discord channel's own snowflake.
--
-- Written by checkInForMatch (app/dashboard/my-team/schedule-actions.ts) in a
-- separate conditional update, not in the boolean write, so the stamp lands exactly
-- once no matter how two simultaneous check-ins interleave.
--
-- Never cleared: a match stops being live because it has scores, not because this
-- goes back to null. Check-in is tournament-only, so season matches keep it null.

alter table matches add column if not exists started_at timestamptz;
