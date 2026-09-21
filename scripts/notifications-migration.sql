-- In-app notification feed (the bell tab).
--
-- One row per EVENT, not per recipient: a season-start notification is a single
-- row that everyone reads, rather than one row per approved player. That keeps
-- the table proportional to how much happens in the league instead of how many
-- players are in it. The cost is that "read" can't be tracked per notification —
-- see accounts.notifications_read_at below.
--
-- audience decides who sees a row, mirroring the pushToX helpers in app/lib/push.ts:
--   all     — every approved player        (pushToAllApproved)
--   admins  — staff only                   (pushToAdmins)
--   draft   — players with draft_entered   (pushToEnteredDraft)
--   team    — one team's roster, team_id    (pushToTeam)
--   users   — explicit list, discord_ids    (pushToUser / pushToDiscordIds)
--
-- category holds the player-facing NotificationCategory and admin_category the
-- separate AdminNotificationCategory. They're different enums in push.ts, and
-- both are needed at READ time: with shared rows there's no per-player filtering
-- at write time, so a player's notification_prefs and league_settings
-- .admin_notification_prefs are applied when the feed is queried instead.

create table if not exists notifications (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  -- Set explicitly by the app rather than defaulted here, so the retention
  -- window lives in one place (NOTIFICATION_TTL_DAYS) instead of two.
  expires_at     timestamptz not null,
  title          text        not null,
  body           text        not null,
  url            text,
  category       text,
  admin_category text,
  audience       text        not null
                             check (audience in ('all', 'admins', 'draft', 'team', 'users')),
  team_id        uuid,
  discord_ids    text[]
);

-- The feed is always "newest first, not expired", and the unread count is the
-- same query with a created_at lower bound, so one index serves both.
create index if not exists notifications_created_at_idx on notifications(created_at desc);
create index if not exists notifications_expires_at_idx on notifications(expires_at);

-- A single marker per account rather than a read/unread row per (player,
-- notification) pair — that join table is exactly the per-person storage this
-- design exists to avoid. The tradeoff: opening the bell marks everything read,
-- including anything that arrived while the page was open.
alter table accounts
  add column if not exists notifications_read_at timestamptz;
