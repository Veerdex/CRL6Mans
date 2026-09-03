-- Per-benefit opt-in for patrons.
--
-- Being entitled to a benefit and wanting it switched on are two different
-- things: a patron may want the Discord role but not a colored name. This map
-- is the second half of that AND — a benefit applies only when the patron's
-- tier grants it AND the patron has turned it on here.
--
-- Shape: { "<benefit id from app/lib/patreon-benefits.ts>": true }. Absent
-- means off, so everything is off by default with no backfill, and a key that
-- no longer matches a catalog id is simply ignored by the read path.
--
-- One benefit is deliberately not stored here: featured-on-support-page
-- predates these switches and already had its own consent column
-- (accounts.patreon_public, also default false). It keeps using that column so
-- the two can never disagree — see PUBLIC_COLUMN_BENEFIT in
-- app/lib/patreon-entitlements.ts, the single place that mapping lives.

alter table accounts add column if not exists patreon_benefit_prefs jsonb not null default '{}'::jsonb;
