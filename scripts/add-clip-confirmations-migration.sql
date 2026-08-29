-- Run this in the Supabase SQL editor to add the moderator-toggleable
-- "confirm this clip is <=60s / appropriate" checkboxes on the Media tab's
-- submit form.

alter table league_settings add column if not exists clip_confirmations_enabled boolean not null default true;
