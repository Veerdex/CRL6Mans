-- Prize pool settings: 1st / 2nd / 3rd-4th place payouts (in CRL coins), for
-- both individual tournaments and the standalone manual season.

alter table tournaments add column if not exists prize_1st integer;
alter table tournaments add column if not exists prize_2nd integer;
alter table tournaments add column if not exists prize_3rd4th integer;

alter table league_settings add column if not exists season_prize_1st integer;
alter table league_settings add column if not exists season_prize_2nd integer;
alter table league_settings add column if not exists season_prize_3rd4th integer;
