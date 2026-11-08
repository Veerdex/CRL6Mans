-- The round each player was taken in during the real draft, which fantasy tiers
-- read (docs/fantasy-rl.md §3): 0 = captain, 1 = 1st-round pick, 2 = 2nd-round
-- pick. Null for anyone not drafted this season. Written by execStartDraft
-- (clears every row, then seats the captains at 0) and completePick.
alter table players add column if not exists draft_round smallint;
