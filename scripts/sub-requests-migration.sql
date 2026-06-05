-- Run this in the Supabase SQL editor to add the sub_requests table.

create table sub_requests (
  id                     uuid        primary key default gen_random_uuid(),
  team_id                uuid        not null references teams(id)   on delete cascade,
  match_id               uuid                    references matches(id) on delete set null,
  player_out_id          uuid        not null references players(id) on delete cascade,
  sub_player_id          uuid                    references players(id) on delete set null,
  reason                 text,
  status                 text        not null default 'pending'
                                     check (status in ('pending', 'approved', 'rejected')),
  admin_note             text,
  requested_by_discord_id text       not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index sub_requests_team_id_idx   on sub_requests(team_id);
create index sub_requests_status_idx    on sub_requests(status);
