-- Set on a player when their team-signup team was valid (3+ accepted members) but
-- didn't make the capacity cutoff during team-signup finalization
-- (execFinalizeTeamSignups in app/lib/discord-bot.ts). Read once and cleared in
-- dashboard/layout.tsx so the player sees a one-time notice next time they load
-- the dashboard.
alter table players add column if not exists team_signup_not_selected boolean not null default false;
