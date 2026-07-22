-- Run this in the Supabase SQL editor to add the Step 9 join gate toggle
-- ("Platform-Account Identity Enforcement" plan).
--
-- join_gate_enabled defaults to false: flipping it on requires every current
-- and future entrant to already hold a verified platform account, which is
-- only reasonable once Steps 1-8 have been operating for a while and the
-- playerbase has actually had a chance to claim/get verified. Turning it on
-- before that would lock out the entire league from joining anything.
alter table league_settings add column if not exists join_gate_enabled boolean not null default false;
