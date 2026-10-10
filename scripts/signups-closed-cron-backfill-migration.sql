-- Run this in the Supabase SQL editor.
-- Repairs tournaments whose sign-ups the scheduler closed. The cron's close
-- branch only ever wrote signups_open: false and never set signups_closed, while
-- the admin's closeSignups writes both — so a cron-closed event read back as
-- "never closed". signups_closed is not a mirror of signups_open: it is what
-- eventAcceptsLateEntries requires before an admin may add a player to a running
-- event, and what teams/page.tsx checks before rendering those buttons at all.
-- A cron-closed tournament could therefore never take a late entry.
--
-- The column already exists; only the rows the cron left behind need fixing.
-- An event whose close time has passed while sign-ups are not open is in exactly
-- that state, and one that never opened sign-ups at all is equally closed now,
-- so the same predicate is correct for both.
update tournaments
   set signups_closed = true,
       updated_at = now()
 where signups_closed = false
   and signups_open = false
   and draft_close_at is not null
   and draft_close_at <= now();
