-- Single-current-value announcement storage on league_settings — no history table.
-- Discord itself is treated as the historical record for past announcements.
alter table league_settings add column if not exists announcement_channel_id text;
alter table league_settings add column if not exists announcement_text text;
alter table league_settings add column if not exists announcement_posted_at timestamptz;
alter table league_settings add column if not exists announcement_posted_by text;
