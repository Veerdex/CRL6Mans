-- Run this in the Supabase SQL editor to add the Media/Clips tab tables.
--
-- clips: one row per submitted clip. Never hard-deleted by the weekly reset —
-- archived_at is set instead, so the current-week feed (archived_at is null)
-- clears out while history is preserved for free (e.g. a future "past winners"
-- page). Admin-initiated deletes (deleteClip) do hard-delete.
--
-- clip_likes: one row per (clip, player) like. clips.likes_count is a
-- denormalized recompute (count(*) from clip_likes), not incremented in place.

create table if not exists clips (
  id             uuid        primary key default gen_random_uuid(),
  player_id      uuid        references players(id) on delete set null,
  title          text        not null,
  url            text        not null,
  normalized_url text        not null,
  platform       text        not null check (platform in ('youtube', 'medal', 'streamable', 'tiktok', 'twitter', 'instagram')),
  embed_url      text        not null,
  thumbnail_url  text,
  likes_count    integer     not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists clips_archived_at_idx on clips(archived_at);
create index if not exists clips_player_id_idx on clips(player_id);

-- Prevents resubmitting the same clip within the current week to farm fresh
-- likes; scoped to active rows only so a past favorite can be re-nominated
-- in a later week after it's archived.
create unique index if not exists clips_active_normalized_url_idx
  on clips(normalized_url) where archived_at is null;

create table if not exists clip_likes (
  clip_id    uuid        not null references clips(id) on delete cascade,
  player_id  uuid        not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clip_id, player_id)
);

alter table league_settings add column if not exists clips_channel_id text;
alter table league_settings add column if not exists last_clip_reset_at timestamptz;
alter table league_settings add column if not exists clip_of_week_id uuid references clips(id) on delete set null;

alter table clips      disable row level security;
alter table clip_likes disable row level security;
