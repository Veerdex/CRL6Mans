-- Per-tab admin overrides for dashboard nav visibility ("hidden" / "shown").
-- Missing key = "auto" (the existing automatic rules in app/dashboard/layout.tsx).
alter table league_settings add column if not exists nav_tab_overrides jsonb not null default '{}'::jsonb;
