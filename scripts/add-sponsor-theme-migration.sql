-- ─────────────────────────────────────────────────────────────
-- SPONSOR THEME — admin-configurable settings-tab theme
--
-- Lets a sponsor's "Theme" content item (name + 3 brand colors) become a
-- selectable appearance option on /dashboard/settings, alongside the
-- existing light/dark/crl6mans themes:
--
--   1. sponsors.theme_name / theme_accent / theme_shell / theme_secondary
--      — set together via the "Theme" row in the sponsor Content editor.
--      theme_accent drives buttons/active-nav/headings, theme_shell drives
--      the sidebar/topbar background, theme_secondary drives highlight/
--      badge accents. All colors are stored as "#rrggbb" hex strings.
--   2. league_settings.settings_tab_sponsor_id — picks which single
--      sponsor's theme is offered on the settings page (same single-row
--      global-config pattern as top_nav_sponsor_id/side_nav_sponsor_id).
--   3. players.theme gets a new fixed 'sponsor' literal. Actual colors are
--      NOT stored per-player — they're resolved at render time from
--      league_settings.settings_tab_sponsor_id, so swapping the active
--      sponsor doesn't require migrating every player's stored theme.
--
-- Run this in the Supabase SQL editor BEFORE deploying the app code that
-- reads these columns — sponsor-actions.ts selects them by name, and a
-- missing column would empty out the entire Sponsors admin tab.
-- ─────────────────────────────────────────────────────────────

alter table sponsors add column if not exists theme_name text;
alter table sponsors add column if not exists theme_accent text;
alter table sponsors add column if not exists theme_shell text;
alter table sponsors add column if not exists theme_secondary text;

alter table league_settings add column if not exists settings_tab_sponsor_id uuid references sponsors(id) on delete set null;

alter table players drop constraint if exists players_theme_check;
alter table players add constraint players_theme_check
  check (theme in ('light', 'dark', 'crl6mans', 'sponsor'));
