-- A director-only test override for Patreon entitlements.
--
-- Benefits (supporter badge, name color, …) are only observable on the site
-- once a real patron exists on a tier that has them assigned, which makes them
-- impossible to check before launch and awkward to check afterwards. This lets
-- a Director pin any account to any tier for entitlement purposes.
--
-- It is deliberately a SEPARATE column rather than writing patreon_status /
-- patreon_tier_title directly:
--
--  * those fields feed the billing surfaces — the patron count, MRR and
--    lifetime totals in the admin Patreon section, and the public "Our Patrons"
--    list on /dashboard/support. A test override written into them would
--    inflate reported revenue and put a non-paying name on a public page.
--  * syncSupporterLinks() rewrites them from Patreon for any account with a
--    refresh token, so an override there would be silently clobbered the
--    moment that director linked their own Patreon.
--
-- Only app/lib/patreon-entitlements.ts reads this column, so it grants perks
-- and nothing else. set_by/set_at exist so a forgotten override is traceable
-- to whoever left it behind.

alter table accounts add column if not exists patreon_tier_override        text;
alter table accounts add column if not exists patreon_tier_override_set_by text;
alter table accounts add column if not exists patreon_tier_override_set_at timestamptz;
