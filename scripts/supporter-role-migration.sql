-- Discord role ID granted to patrons for the "Discord role" Patreon benefit.
-- Set via the /admin setsupporterrole slash command.
alter table league_settings add column if not exists supporter_role_id text;
