-- 1v1 / 2v2 tournament support.
--
-- `tournaments.team_size` is the authored setting; activateTournamentRuntime
-- mirrors it into `league_settings.team_size`, which is what the draft/season
-- machinery actually reads. Seasons never set it, so the default of 3 keeps
-- every existing code path on the classic 3v3 league.

alter table tournaments
  add column if not exists team_size int not null default 3;

alter table league_settings
  add column if not exists team_size int not null default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tournaments_team_size_range'
  ) then
    alter table tournaments
      add constraint tournaments_team_size_range check (team_size between 1 and 3);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'league_settings_team_size_range'
  ) then
    alter table league_settings
      add constraint league_settings_team_size_range check (team_size between 1 and 3);
  end if;
end $$;
