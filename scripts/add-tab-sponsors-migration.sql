-- Per-tab "Sponsored by ___" attribution, shown on each standard dashboard tab.
-- Maps a NAV_TAB_OPTIONS key (see app/lib/nav-tabs.ts) to a sponsor id.
-- Missing key = no sponsor shown for that tab.
alter table league_settings add column if not exists tab_sponsors jsonb not null default '{}'::jsonb;
