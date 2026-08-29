-- ============================================================================
-- DESIGNS: sponsor-independent visual assets for tournaments/seasons/nav
--
-- Mirrors the sponsor system's visual-asset mechanics (background image,
-- top-nav image, side-nav image, per-placement crop) as its own lightweight
-- entity, with none of the sponsor-specific baggage (no promo code, links,
-- click URL, "Sponsored by" byline, invite/member system, theme).
--
-- A tournament/season/nav slot picks either a sponsor OR a design — the two
-- id columns are siblings, and app code is responsible for only ever setting
-- one of each pair at a time (same convention as every other nullable
-- league_settings FK pair in this schema).
--
-- Run this in the Supabase SQL editor.
-- ============================================================================

create table if not exists designs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  background_image_url text,
  top_nav_image_url text,
  side_nav_image_url text,
  content_crop jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table designs disable row level security;

alter table tournaments add column if not exists design_id uuid references designs(id) on delete set null;
alter table league_settings add column if not exists season_design_id uuid references designs(id) on delete set null;
alter table league_settings add column if not exists top_nav_design_id uuid references designs(id) on delete set null;
alter table league_settings add column if not exists side_nav_design_id uuid references designs(id) on delete set null;
