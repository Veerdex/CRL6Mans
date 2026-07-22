-- Run this in the Supabase SQL editor to add platform-account identity
-- verification tables (player_platform_accounts, player_platform_account_events).
--
-- These back the "Platform-Account Identity Enforcement" plan: replay-derived
-- platform IDs (Steam/Epic/PlayStation/Xbox/Switch/PsyNet) are certified only
-- once a player's claim to that ID has been admin-verified. Self-reported
-- claims and display names are evidence, never proof, until verified.

create table if not exists player_platform_accounts (
  id                          uuid        primary key default gen_random_uuid(),
  player_id                   uuid        not null references players(id) on delete cascade,
  platform                    text        not null
                                          check (platform in ('steam', 'epic', 'playstation', 'xbox', 'switch', 'psynet')),

  -- Nullable: console platforms don't collect this from the player directly —
  -- the console verification-replay workflow populates it after the fact.
  platform_account_id         text,

  claimed_display_name        text,
  verified_display_name       text,
  claimed_tracker_url         text,
  claimed_verification_replay_path text,

  verification_status         text        not null default 'claimed'
                                          check (verification_status in
                                            ('claimed', 'pending_verification', 'verified', 'rejected', 'withdrawn', 'revoked')),
  verification_method         text        check (verification_method in
                                            ('steam_openid', 'epic_oauth', 'official_account_page',
                                             'console_replay_network', 'admin_live', 'legacy_manual')),
  verification_replay_sha256  text,

  verified_by                 text,  -- discord_id of the verifying administrator
  verified_at                 timestamptz,
  valid_from                  timestamptz,
  valid_until                 timestamptz,

  revoked_by                  text,  -- discord_id of the revoking administrator
  revoked_at                  timestamptz,

  admin_note                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- A verified account is certification-ready: every field the resolver
  -- relies on (platform_account_id, method, verifier, timestamp, validity
  -- start) must be present, not just the status flag.
  check (
    verification_status != 'verified'
    or (
      platform_account_id is not null
      and verification_method is not null
      and verified_by is not null
      and verified_at is not null
      and valid_from is not null
    )
  ),

  check (verification_status != 'revoked' or revoked_at is not null)
);

alter table player_platform_accounts add column if not exists claimed_verification_replay_path text;

create index if not exists player_platform_accounts_player_id_idx on player_platform_accounts(player_id);
create index if not exists player_platform_accounts_platform_idx on player_platform_accounts(platform);
create index if not exists player_platform_accounts_status_idx   on player_platform_accounts(verification_status);

-- Uniqueness only applies while a claim is live (claimed/pending_verification/
-- verified). Rejected, withdrawn, and revoked rows must not permanently block
-- the ID's legitimate owner from claiming it again later.
create unique index if not exists player_platform_accounts_active_id_idx
  on player_platform_accounts(platform, platform_account_id)
  where verification_status in ('claimed', 'pending_verification', 'verified')
    and platform_account_id is not null;

create table if not exists player_platform_account_events (
  id           uuid        primary key default gen_random_uuid(),
  account_id   uuid        not null references player_platform_accounts(id) on delete cascade,
  event_type   text        not null
                           check (event_type in
                             ('claimed', 'verification_submitted', 'verified', 'rejected',
                              'withdrawn', 'revoked', 'corrected', 'note_added')),
  actor        text        not null,  -- discord_id of the player or administrator who caused the event
  detail_json  jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists player_platform_account_events_account_idx on player_platform_account_events(account_id);
create index if not exists player_platform_account_events_type_idx    on player_platform_account_events(event_type);

insert into storage.buckets (id, name, public)
values ('platform-verification-replays', 'platform-verification-replays', false)
on conflict (id) do update set public = excluded.public;

alter table player_platform_accounts       disable row level security;
alter table player_platform_account_events disable row level security;
