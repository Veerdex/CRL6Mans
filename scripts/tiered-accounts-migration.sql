-- ─────────────────────────────────────────────────────────────
-- TIERED ACCOUNT MODEL — Phase A (additive only)
--
-- Introduces two new tables layered on top of the existing `players`
-- table, which is left completely untouched by this migration:
--
--   Tier 1 `accounts`        — created on every Discord login, regardless
--                              of registration status.
--   Tier 2 `pending_players` — created when a registration form is
--                              submitted (account_id references accounts).
--   Tier 3 `players`         — unchanged for now (existing table). Once
--                              app code is fully migrated, a later Phase B
--                              migration narrows this table down to the
--                              roster-only fields and starts inserting new
--                              rows with id = accounts.id.
--
-- Nothing is dropped or renamed here. This is safe to run against the
-- live DB without any app-code changes having shipped yet — the app
-- keeps working exactly as before until the Phase A code changes land.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- TIER 1: ACCOUNTS
-- ─────────────────────────────────────────────
create table if not exists accounts (
  id                         uuid        primary key default gen_random_uuid(),
  discord_id                 text        not null unique,
  username                   text,
  avatar                     text,
  status                     text        not null default 'unregistered'
                                         check (status in ('unregistered', 'pending', 'approved', 'rejected', 'banned')),
  theme                      text        not null default 'crl6mans'
                                         check (theme in ('light', 'dark', 'crl6mans')),
  nav_layout                 text        not null default 'sidebar'
                                         check (nav_layout in ('sidebar', 'topbar')),
  display_name               text,
  crl_coins                  integer     not null default 0,
  coin_grant_pending_start   boolean     not null default false,
  coin_grant_pending_weekly  boolean     not null default false,
  ban_reason                 text,
  kick_reason                text,
  kicked_until               timestamptz,
  mfa_enabled                boolean     not null default false,
  session_version            integer     not null default 0,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists accounts_discord_id_idx on accounts(discord_id);
create index if not exists accounts_status_idx     on accounts(status);

-- ─────────────────────────────────────────────
-- TIER 2: PENDING_PLAYERS
-- ─────────────────────────────────────────────
create table if not exists pending_players (
  account_id         uuid        primary key references accounts(id) on delete cascade,
  tracker_url        text        not null default '',
  peak_3v3           text        not null default '0',
  current_3v3        text        not null default '0',
  peak_2v2           text        not null default '0',
  current_2v2        text        not null default '0',
  college_image_url  text        not null default '',
  sub_willing        boolean     not null default false,
  -- When the reported tracker/MMR values were last confirmed accurate.
  -- Lives here (not on `players`) because it's a confirmation of THIS row's
  -- data, not of roster/draft state; task #15's Tier 3 insert on approval
  -- seeds `players.tracker_confirmed_at` from this value once, after which
  -- the two evolve independently (draft/tournament re-confirmation only
  -- touches the Tier 3 copy).
  tracker_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- BACKFILL
--
-- Every existing `players` row represents someone who has already
-- logged in via Discord, so it becomes at least a Tier 1 account.
-- `accounts.id` is set equal to the existing `players.id` (not a fresh
-- uuid) so every current FK into `players.id` keeps resolving, and so
-- Tier 1 <-> Tier 3 is already a 1:1 same-id relationship for anyone
-- who is currently approved or banned.
--
-- Rows with status 'pending' or 'rejected' also get backfilled into
-- accounts, but their corresponding `players` row is a pre-tier-model
-- artifact — under the new model, pending/rejected accounts have no
-- Tier 3 row. That stale `players` row is intentionally left in place
-- (Phase A never deletes from `players`); app code must gate Tier 3
-- membership on `accounts.status in ('approved', 'banned')`, not on
-- `players` row existence alone, until Phase B physically removes them.
--
-- `pending_players` is backfilled from EVERY existing `players` row, not
-- just `status = 'pending'` ones. Under the new model MMR/tracker fields
-- live in Tier 2 and are read via a join back to `pending_players` for
-- everyone (approved players included) — every current `players` row
-- already went through registration and carries real MMR, so skipping
-- non-pending rows here would silently zero out rankValue()/draft order/
-- the stats leaderboard for every approved player once Phase B drops the
-- source columns from `players`.
-- ─────────────────────────────────────────────
insert into accounts (
  id, discord_id, username, avatar, status, theme, nav_layout, display_name,
  crl_coins, coin_grant_pending_start, coin_grant_pending_weekly,
  ban_reason, kick_reason, kicked_until, mfa_enabled, session_version,
  created_at, updated_at
)
select
  id, discord_id, username, avatar, status, theme, nav_layout, display_name,
  coalesce(crl_coins, 0), coalesce(coin_grant_pending_start, false), coalesce(coin_grant_pending_weekly, false),
  ban_reason, kick_reason, kicked_until, coalesce(mfa_enabled, false), coalesce(session_version, 0),
  created_at, updated_at
from players
on conflict (id) do nothing;

insert into pending_players (
  account_id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2,
  college_image_url, sub_willing, tracker_confirmed_at, created_at, updated_at
)
select
  id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2,
  -- Was players.college_image_url; that column is dropped (see
  -- scripts/drop-players-college-image-url.sql) so there is nothing to carry
  -- over. Proof is deleted the moment a registration is decided anyway.
  '', coalesce(sub_willing, false), tracker_confirmed_at, created_at, updated_at
from players
on conflict (account_id) do nothing;

-- ─────────────────────────────────────────────
-- TIER 3: PLAYERS — add the explicit account_id join column
--
-- The `players` table itself is untouched otherwise (no drops, no renames).
-- `account_id` is added purely additively so PostgREST/supabase-js can embed
-- `accounts -> players` unambiguously via a single declared FK, without
-- relying on the (unenforced) numeric equality between `players.id` and
-- `accounts.id`. Backfilled to match `id` for every existing row (the
-- accounts backfill above guarantees a matching accounts.id already exists
-- for every players.id, so this satisfies the FK).
--
-- Left NULLABLE here (not NOT NULL) so this migration stays safe to run
-- before the app-code changes ship: today's `registerPlayer`/
-- `approvePlayerWithEdits` insert/upsert into `players` without setting
-- `account_id`, and a NOT NULL constraint would turn every registration or
-- approval into a hard failure until that code lands. Once task #14/#15's
-- app code always sets `account_id`, a Phase B migration can safely add
-- `NOT NULL` here.
-- ─────────────────────────────────────────────
alter table players add column if not exists account_id uuid references accounts(id);
update players set account_id = id where account_id is null;
create unique index if not exists players_account_id_idx on players(account_id);

-- ─────────────────────────────────────────────
-- UNBAN SAFETY: retarget cascade-delete FKs into players(id)
--
-- Approved design: unbanning a player deletes their `players` (Tier 3) and
-- `pending_players` (Tier 2) rows so they genuinely re-register from
-- scratch, while `accounts` (Tier 1) survives with status reset to
-- 'unregistered'. As originally defined, several tables cascade-delete
-- when their `players(id)` FK target disappears — deleting the `players`
-- row on unban would silently wipe tournament signups, sub requests,
-- profile-edit history, and platform-account verification for that person.
-- That history is not test data; it's the record moderation might need
-- later (e.g. re-checking a past ban-evasion flag on `player_platform_accounts`).
--
-- Retarget those FKs from ON DELETE CASCADE to ON DELETE SET NULL so the
-- historical rows survive an unban, orphaned but intact. `drop not null`
-- is required first since a `not null` column cannot accept the NULL a
-- SET NULL FK writes on delete.
--
-- `player_game_stats.player_id` is already ON DELETE SET NULL (untouched
-- here). `wagers`/`parlays`/`game_scores` are keyed on raw `discord_id`,
-- not `players(id)`, so they have no FK exposure regardless.
--
-- Constraint names below follow this repo's convention of unnamed FKs
-- (Postgres default naming: <table>_<column>_fkey) — if a live constraint
-- was named explicitly and differs, adjust the DROP CONSTRAINT name to match.
-- ─────────────────────────────────────────────
alter table tournament_entries drop constraint if exists tournament_entries_player_id_fkey;
alter table tournament_entries alter column player_id drop not null;
alter table tournament_entries add constraint tournament_entries_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

alter table team_signups drop constraint if exists team_signups_creator_player_id_fkey;
alter table team_signups alter column creator_player_id drop not null;
alter table team_signups add constraint team_signups_creator_player_id_fkey
  foreign key (creator_player_id) references players(id) on delete set null;

alter table team_signup_members drop constraint if exists team_signup_members_player_id_fkey;
alter table team_signup_members alter column player_id drop not null;
alter table team_signup_members add constraint team_signup_members_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

alter table sub_requests drop constraint if exists sub_requests_player_out_id_fkey;
alter table sub_requests alter column player_out_id drop not null;
alter table sub_requests add constraint sub_requests_player_out_id_fkey
  foreign key (player_out_id) references players(id) on delete set null;

alter table player_edit_requests drop constraint if exists player_edit_requests_player_id_fkey;
alter table player_edit_requests alter column player_id drop not null;
alter table player_edit_requests add constraint player_edit_requests_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

alter table player_platform_accounts drop constraint if exists player_platform_accounts_player_id_fkey;
alter table player_platform_accounts alter column player_id drop not null;
alter table player_platform_accounts add constraint player_platform_accounts_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

alter table wager_balance_adjustments drop constraint if exists wager_balance_adjustments_player_id_fkey;
alter table wager_balance_adjustments alter column player_id drop not null;
alter table wager_balance_adjustments add constraint wager_balance_adjustments_player_id_fkey
  foreign key (player_id) references players(id) on delete set null;

-- ─────────────────────────────────────────────
-- increment_crl_coins RPC — retarget to accounts
--
-- Called uniformly as rpc("increment_crl_coins", { player_discord_id, coin_amount })
-- from every wager/parlay payout and refund path in app/lib/discord-bot.ts.
-- Already keyed by discord_id, so no app-code changes are needed — only
-- the function body moves from `players` to `accounts`.
-- ─────────────────────────────────────────────
create or replace function increment_crl_coins(player_discord_id text, coin_amount integer)
returns void as $$
  update accounts
  set crl_coins = crl_coins + coin_amount, updated_at = now()
  where discord_id = player_discord_id;
$$ language sql;
