-- Discord role ID given to every participant of a 1v1 tournament — the shared
-- stand-in for the per-team roles a 1v1 would otherwise need one of per player.
-- Set via the /admin settournamentid slash command.
--
-- When null the bot falls back to resolving a role literally named "Tournament"
-- (creating it if absent during a 1v1), which is the pre-existing behavior — so
-- this column is purely additive. Storing the ID means the role can be renamed
-- in Discord without the bot minting a duplicate on the next event.
alter table league_settings add column if not exists tournament_role_id text;
