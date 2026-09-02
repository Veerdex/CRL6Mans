-- Backfill: nicknames saved before saveDisplayName was fixed
--
-- APPLIED 2026-09-02 (2 rows: sacksquerque, awannabe_nerd). Idempotent — only
-- fills accounts.display_name where it is NULL, so a re-run is a no-op.
--
-- saveDisplayName used to write `players.display_name` only, while every
-- Tier-1-migrated surface (getPlayerInfo, the sidebar, the wagers leaderboard)
-- reads `accounts.display_name`. Anyone who set or changed a nickname after the
-- tiered-accounts migration therefore has a name on Tier 3 that Tier 1 never saw.
--
-- Run once. Only copies a name where accounts has none, so it can never clobber
-- a nickname the fixed code already wrote to the source of truth.

update accounts a
set    display_name = p.display_name,
       updated_at   = now()
from   players p
where  p.account_id = a.id
  and  p.display_name is not null
  and  a.display_name is null;
