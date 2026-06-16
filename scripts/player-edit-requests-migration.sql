-- Run this in the Supabase SQL editor to add the player_edit_requests table.

create table if not exists player_edit_requests (
  id           uuid        primary key default gen_random_uuid(),
  player_id    uuid        not null references players(id) on delete cascade,
  discord_id   text        not null,
  username     text        not null,
  tracker_url  text        not null,
  peak_3v3     text        not null,
  current_3v3  text        not null,
  peak_2v2     text        not null,
  current_2v2  text        not null,
  status       text        not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected')),
  admin_note   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists player_edit_requests_player_id_idx on player_edit_requests(player_id);
create index if not exists player_edit_requests_status_idx    on player_edit_requests(status);
