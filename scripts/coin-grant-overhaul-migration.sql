-- Coin grant overhaul.
-- Run once in the Supabase SQL editor.

-- 1. New accounts start with 500 Westside Wages instead of 1000; the other 500
--    is now earned by submitting a registration (see #2). Changing the default
--    does NOT touch existing rows — accounts created before this keep 1000.
alter table accounts alter column crl_coins set default 500;

-- 2. The +500 registration bonus. registerPlayer is re-runnable after a
--    rejection, so the permanent flag is what stops it being farmed; the pending
--    flag is the usual lazy-credit handoff that makes the toast fire.
alter table accounts add column if not exists registration_bonus_granted  boolean not null default false;
alter table accounts add column if not exists coin_grant_pending_register boolean not null default false;

-- 3. Claim windows for the two lazily-credited event grants. A pending flag past
--    its expiry is cleared without crediting. Kept separate from
--    league_settings.last_coin_grant_at, which is shared by both grant paths.
alter table league_settings add column if not exists start_grant_expires_at  timestamptz;
alter table league_settings add column if not exists weekly_grant_expires_at timestamptz;
