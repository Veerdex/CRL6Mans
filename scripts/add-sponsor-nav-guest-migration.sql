-- ─────────────────────────────────────────────────────────────
-- SPONSORS — nav placement, guest accounts, tier removal
--
-- Three changes bundled together since they ship in the same feature pass:
--
--   1. accounts.is_guest — marks a Tier 1 account created via a sponsor's
--      guest join flow (no Discord OAuth involved). Guests never get a
--      `players`/`pending_players` row and are blocked from
--      /dashboard/register at the page level.
--   2. sponsors.top_nav_image_url / side_nav_image_url — per-sponsor
--      assets uploaded for a specific nav placement, alongside the
--      existing logo_url/video_url. league_settings.top_nav_sponsor_id /
--      side_nav_sponsor_id pick which single sponsor currently occupies
--      each slot (same single-row global-config pattern used everywhere
--      else in league_settings).
--   3. Drop sponsors.tier — replaced by per-sponsor nav placement, which
--      gives finer per-sponsor control than the old small/big split did.
--
-- WARNING: unlike every other migration in this project, part 3 is NOT
-- additive — `drop column` permanently deletes existing tier data. Parts
-- 1 and 2 are safe to run standalone at any time; only run part 3 once
-- the app code that reads/writes `sponsors.tier` has actually been
-- redeployed (it no longer will be, after this feature ships).
-- ─────────────────────────────────────────────────────────────

-- 1. Guest accounts
alter table accounts add column if not exists is_guest boolean not null default false;
create index if not exists accounts_is_guest_idx on accounts(is_guest) where is_guest;

-- 2. Nav placement
alter table sponsors add column if not exists top_nav_image_url text;
alter table sponsors add column if not exists side_nav_image_url text;
alter table league_settings add column if not exists top_nav_sponsor_id uuid references sponsors(id) on delete set null;
alter table league_settings add column if not exists side_nav_sponsor_id uuid references sponsors(id) on delete set null;

-- 3. Drop tier (NOT additive — see warning above)
alter table sponsors drop column if exists tier;
