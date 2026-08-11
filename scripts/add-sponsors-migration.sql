-- ─────────────────────────────────────────────────────────────
-- SPONSORS — additive migration
--
-- Phase 1 of the sponsor feature: a `sponsors` entity an admin creates,
-- plus `sponsor_members` linking Tier 1 `accounts` rows to a sponsor via
-- an invite-link claim flow (see app/sponsor/join/[token]/route.ts).
--
-- A sponsor rep does NOT need to register as a player — this sits
-- entirely at the accounts (Tier 1) level, independent of the
-- pending_players/players tiers, the same way staff_roles does.
--
-- `max_uses` is admin-set and can be raised at any time; how many times
-- a link has been used is derived as count(*) from sponsor_members where
-- sponsor_id = X rather than stored, so there's nothing to keep in sync.
--
-- Safe to run against a live DB — pure additive `create table if not exists`.
-- ─────────────────────────────────────────────────────────────

create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_token text not null unique,
  max_uses integer not null default 1,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sponsor_members (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsors(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (account_id)
);
