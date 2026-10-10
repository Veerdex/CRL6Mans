-- Run this in the Supabase SQL editor. Safe to run before or after deploying the
-- matching code: the claim filter errors on a missing column, no row comes back,
-- and pre-generation simply never fires — the bracket then builds at the start
-- time exactly as it does today. That is the deliberate direction, since reading
-- a missing column as "not yet claimed" would rebuild the bracket every minute.
--
-- Claims a tournament's one-time early bracket build. The scheduler runs every
-- minute and the pre-generation window stays open from 30 minutes before
-- season_start_at until the season actually starts, so without a stored claim
-- buildAndSaveBracket would re-run on every tick — and it opens by deleting
-- every stage match, so a re-run mid-window discards any admin reseeding and
-- would eventually wipe scored matches once the event is live.
--
-- Nothing clears this column, by design: a tournament's bracket is built once,
-- and execStartSeason reads the stamp to know it must not rebuild over it.
-- Regenerating by hand from the season tab calls buildAndSaveBracket directly
-- and is unaffected by the claim.
alter table tournaments add column if not exists bracket_generated_at timestamptz;

-- Backfill: an event that has already started built its bracket the old way, at
-- the start itself. Stamping it keeps execStartSeason's "was this pre-generated"
-- read truthful for anything already running, and costs nothing for a finished
-- one. Scheduled events are deliberately left null — one inside its 30-minute
-- window at deploy time should pre-generate on the next tick, which is the whole
-- point of the feature.
update tournaments
   set bracket_generated_at = coalesce(started_at, updated_at)
 where status in ('active', 'completed', 'cancelled');
