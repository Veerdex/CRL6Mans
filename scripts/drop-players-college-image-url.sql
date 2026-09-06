-- Drop the Tier 3 copy of the enrollment proof URL.
--
-- players.college_image_url was written on approval and on test-account
-- creation and read nowhere — Player.college_image_url has always been sourced
-- from pending_players (Tier 2) via toPlayer in app/lib/players.ts. Keeping a
-- second copy of a sensitive document URL that nothing reads is pure exposure.
--
-- Already run against production on 2026-09-05. Recorded here so schema.sql and
-- this drop stay consistent for anyone rebuilding the database from scratch.

alter table players drop column if exists college_image_url;
