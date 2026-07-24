-- League-wide switch letting a director disable/enable substitute requests.
-- When false, new sub requests can't be submitted; requests already in flight
-- (pending/escalated/approved) still resolve normally.
alter table league_settings add column if not exists subs_enabled boolean not null default true;
