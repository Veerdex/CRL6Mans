-- Lets an admin post an announcement to the website banner only, Discord only, or both.
alter table league_settings add column if not exists announcement_destination text not null default 'both';
