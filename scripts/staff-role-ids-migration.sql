-- Discord role IDs for each staff tier, so the bot can @mention/ping the right
-- role (e.g. notifying moderators when a sub request is escalated).
-- Set via the /setmoderatorid, /setdirectorid, /setceoid slash commands.
alter table league_settings add column if not exists moderator_role_id text;
alter table league_settings add column if not exists director_role_id  text;
alter table league_settings add column if not exists ceo_role_id        text;
