-- Cumulative tier benefits + per-tier benefit values.
--
-- IMPORTANT: this also folds in scripts/fix-patreon-tiers-migration.sql,
-- which was written but never actually run against the database. Production
-- was still on the original add-patreon-tiers-migration.sql schema
-- (patreon_tiers / patreon_benefits rows joined by uuid), while the code has
-- been querying patreon_tier_benefits.tier_title for a while — so every read
-- from the Tiers & Benefits admin section has been failing silently and the
-- section always rendered as though nothing was assigned. Verified all three
-- old tables were empty before dropping them, so nothing is lost.
--
-- Re-runnable: safe to apply again if you already ran an earlier version of
-- this file.
--
-- The shape this lands on:
--
-- 1. patreon_tier_benefits — the join between a real Patreon tier (by title,
--    since tiers live on the campaign, not in this database) and a benefit id
--    from the hardcoded catalog in app/lib/patreon-benefits.ts. `value` is
--    per-tier configuration for benefits that carry one — today the name size
--    on the Support page, so a single `featured-on-support-page` id can mean
--    Large at $10 and Small at $2. Null for benefits that are purely on/off.
--
-- 2. patreon_tier_prices — tier title -> monthly price, refreshed from the
--    live Patreon campaign every time a director opens the Tiers & Benefits
--    admin section. This is what makes tiers *cumulative*: a patron holds
--    every benefit assigned at their tier's price and below.
--
--    It's a separate table rather than a column on patreon_tier_benefits
--    because a tier with no benefits assigned directly to it still needs a
--    known price — otherwise the top tier would inherit nothing until someone
--    checked a box on it.
--
--    Prices are NOT read from accounts.patreon_entitled_cents: annual pledges,
--    grandfathered pledges, and pay-above-tier all decouple what a patron pays
--    from what their tier lists at, which would silently drop them a tier.

drop table if exists patreon_tier_benefits;
drop table if exists patreon_tiers;
drop table if exists patreon_benefits;

create table patreon_tier_benefits (
  tier_title text not null,
  benefit_id text not null,
  value      text,
  primary key (tier_title, benefit_id)
);

alter table patreon_tier_benefits disable row level security;

create table if not exists patreon_tier_prices (
  tier_title   text        primary key,
  amount_cents integer,
  updated_at   timestamptz not null default now()
);

alter table patreon_tier_prices disable row level security;
