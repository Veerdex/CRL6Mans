-- Set on a player when their team-signup team never reached the 3-player minimum
-- by the time team-signup finalization ran (execFinalizeTeamSignups in
-- app/lib/discord-bot.ts), so it was never entered into the tournament. Read once
-- and cleared in dashboard/layout.tsx, mirroring team_signup_not_selected.
alter table players add column if not exists team_signup_too_few_players boolean not null default false;
