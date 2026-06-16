-- Optional minimum peak MMR to enter the season draft pool. NULL = no minimum.
-- Enforced in enterDraft with OR semantics (meet the 2v2 OR the 3v3 threshold).
alter table league_settings add column if not exists min_mmr_2v2 integer;
alter table league_settings add column if not exists min_mmr_3v3 integer;
