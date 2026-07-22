-- When true, the season's opening round is held back from auto-opening (creating
-- live Discord match channels) even once its schedule is set and both teams are
-- assigned. An admin must explicitly click "Start Round" in the scheduling UI to
-- flip this off and let the round go live, giving them a chance to fix a bad
-- schedule on round 1 before it's irreversible.
--
-- Set to true by execStartSeason() at the start of every season; cleared by the
-- startFirstRound() server action once the admin manually starts round 1.
alter table league_settings add column if not exists round1_manual_start_pending boolean not null default false;
