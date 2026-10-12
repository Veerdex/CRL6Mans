-- A forfeited match is still stored as 1-0 so the bracket has a winner to
-- advance, but nothing on the row said the games were never played: a bye is
-- stored as 1-0 too, and a BO1 stage makes 1-0 a legitimate played result. The
-- bracket therefore showed a no-show as a score. This column is the only thing
-- that tells the three apart.
--
-- execReportMatchResult writes it in its own update, after the claim, so a
-- deploy landing before this migration costs the label rather than every result
-- report. Run this first anyway.

alter table matches add column if not exists forfeit boolean not null default false;

-- The one forfeit this event has so far: the WB R2 no-show (Kings missed the
-- 10-minute check-in). Targeted by its bracket position rather than by its
-- score, because every other 1-0 in the table is a bye.
update matches
   set forfeit = true
 where stage = 'de_winners'
   and round = 2
   and match_number = 1
   and status = 'completed';
