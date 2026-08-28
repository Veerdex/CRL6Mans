-- ============================================================================
-- Theme Designer: reusable saved themes for sponsors
--
-- Today a sponsor's "Theme" content item only stores 3 raw hex fields
-- (theme_accent/theme_shell/theme_secondary) inline on the sponsors row.
-- This introduces a `themes` table so directors can design and save full,
-- named, reusable 7-color palettes in a Theme Designer tab, then assign one
-- to a sponsor by id instead of picking colors inline every time.
--
-- Run this in the Supabase SQL editor.
-- ============================================================================

create table if not exists themes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null default 'light' check (mode in ('light', 'dark')),
  bg text not null,        -- page background
  surface text not null,   -- card/widget background
  border text not null,    -- borders, input backgrounds
  text text not null,      -- primary text
  muted text not null,     -- secondary/muted text
  accent text not null,    -- buttons, links, active states
  secondary text not null, -- highlights, badges
  shell text not null,     -- sidebar / top+bottom nav bars
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table themes disable row level security;

alter table sponsors add column if not exists theme_id uuid references themes(id) on delete set null;

-- Backfill: any sponsor with an existing inline theme becomes its own saved
-- theme, using the same fixed bg/surface/border/text/muted defaults the
-- light/dark base sponsor CSS block already hardcodes today.
insert into themes (name, mode, bg, surface, border, text, muted, accent, secondary, shell)
select
  theme_name,
  coalesce(theme_mode, 'light'),
  case when theme_mode = 'dark' then '#09090b' else '#d5dbf2' end,
  case when theme_mode = 'dark' then '#18181b' else '#f1f3fd' end,
  case when theme_mode = 'dark' then '#27272a' else '#c2c9ec' end,
  case when theme_mode = 'dark' then '#ffffff' else '#1e1d44' end,
  case when theme_mode = 'dark' then '#a1a1aa' else '#6d72a6' end,
  coalesce(theme_accent, '#e88a24'),
  coalesce(theme_secondary, '#e88a24'),
  coalesce(theme_shell, '#3736ac')
from sponsors
where theme_name is not null;

update sponsors set theme_id = themes.id
from themes
where sponsors.theme_name = themes.name and sponsors.theme_id is null;

alter table sponsors drop column if exists theme_name;
alter table sponsors drop column if exists theme_accent;
alter table sponsors drop column if exists theme_shell;
alter table sponsors drop column if exists theme_secondary;
alter table sponsors drop column if exists theme_mode;
