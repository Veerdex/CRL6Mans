-- Make the college-ids bucket private.
--
-- Enrollment proof was stored in a public bucket, and the object names are
-- `<discord snowflake>-<ms timestamp>.<ext>` — a public Discord id plus a
-- narrow guess, so the URLs were not meaningfully secret. Nothing in the app
-- links the public URL any more: both surfaces that show a proof (the admin
-- registration card and the rejected player's own re-submit page) mint a
-- one-hour signed URL server-side via collegeIdSignedUrl in
-- app/lib/college-ids.ts, which works on a private bucket.
--
-- Run this in the Supabase SQL editor. Uploads, deletes and signed URLs all go
-- through the service-role key, so none of them are affected.

update storage.buckets set public = false where id = 'college-ids';
