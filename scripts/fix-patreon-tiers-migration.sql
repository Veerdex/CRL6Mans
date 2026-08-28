-- Corrects the Tiers & Benefits design: tiers are NOT hand-authored on the
-- website — they're whatever tier titles are configured on the actual
-- Patreon campaign (same source `patreon_tier_title` already uses on the
-- Patrons tab). Benefits are NOT admin-created either — they're a hardcoded
-- catalog in app/lib/patreon-benefits.ts (title + description, edited in
-- code). All directors do on the website is pick which hardcoded benefits
-- apply to each real Patreon tier.
--
-- This replaces the patreon_benefits/patreon_tiers/patreon_tier_benefits
-- tables from add-patreon-tiers-migration.sql with a single join table keyed
-- on the tier's Patreon title (text) and a benefit's hardcoded id (text) —
-- neither side is a row in this database anymore.
--
-- Safe to run even though no benefits existed yet to assign (the benefit
-- catalog was still empty), so there's nothing meaningful to lose here.

drop table if exists patreon_tier_benefits;
drop table if exists patreon_tiers;
drop table if exists patreon_benefits;

create table if not exists patreon_tier_benefits (
  tier_title text not null,
  benefit_id text not null,
  primary key (tier_title, benefit_id)
);

alter table patreon_tier_benefits disable row level security;
