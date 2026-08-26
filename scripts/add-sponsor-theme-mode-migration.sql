-- ─────────────────────────────────────────────────────────────
-- SPONSOR THEME — light/dark base mode
--
-- The sponsor-configurable settings-tab theme (see
-- add-sponsor-theme-migration.sql) was hardcoded to a light base — the
-- same fixed light-inverted surface scale CRL6Mans uses, regardless of
-- what accent/shell/secondary colors the admin picked. This lets the
-- admin also choose a dark base (mirroring the built-in "dark" theme's
-- surface scale) via the same "Theme" content item in the sponsor editor.
-- ─────────────────────────────────────────────────────────────

alter table sponsors add column if not exists theme_mode text not null default 'light' check (theme_mode in ('light', 'dark'));
