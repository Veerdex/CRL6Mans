-- Discord role ID granted to a player when an admin approves their registration.
-- Set via the /setregisteredrole slash command.
--
-- When null the bot falls back to resolving a role literally named "Registered"
-- (creating it if absent), which is the pre-existing behavior — so this column is
-- purely additive. Storing the ID means renaming the role in Discord no longer
-- causes a duplicate to be created on the next approval.
alter table league_settings add column if not exists registered_role_id text;
