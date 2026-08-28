-- Run this in the Supabase SQL editor to add admin-designed Patreon tiers and
-- a reusable benefit catalog.
--
-- patreon_benefits: a catalog of perks (name + description) that directors
-- can hand out to tiers. Descriptive only for now — no benefit carries a
-- functional value (e.g. a color), it's just a reference for what a tier
-- includes.
--
-- patreon_tiers: hand-authored by directors (not pulled live from Patreon
-- the way patrons.tsx's tier stats are). name is expected to match the real
-- Patreon tier title so the two can be cross-referenced later, but nothing
-- enforces that here.
--
-- patreon_tier_benefits: many-to-many join between the two.

create table if not exists patreon_benefits (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists patreon_tiers (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists patreon_tier_benefits (
  tier_id    uuid not null references patreon_tiers(id) on delete cascade,
  benefit_id uuid not null references patreon_benefits(id) on delete cascade,
  primary key (tier_id, benefit_id)
);

alter table patreon_benefits      disable row level security;
alter table patreon_tiers         disable row level security;
alter table patreon_tier_benefits disable row level security;
