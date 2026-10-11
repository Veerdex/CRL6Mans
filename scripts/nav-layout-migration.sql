-- Desktop navigation layout preference: 'topbar' (default) or 'sidebar'
-- (tabs across the top with a bottom bar). Mirrored to a cookie for no-flash SSR.
alter table players add column if not exists nav_layout text not null default 'topbar';
