-- Per-category admin notification toggles (match reporting, sub requests,
-- registrations, profile changes). NULL / missing key = on by default.
alter table league_settings add column if not exists admin_notification_prefs jsonb;
