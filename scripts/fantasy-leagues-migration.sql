-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — leagues, members and invites (slice 1: pre-draft only)
--
-- See docs/fantasy-rl.md. This slice covers everything up to the draft:
-- creating a league, joining, leaving, invites by name, and the commissioner's
-- rename / visibility / remove powers. Draft, tiers, lineups and scoring add
-- their own tables later.
--
-- A fantasy season is its own row rather than a seasons/tournaments id: a
-- running manual season has no `seasons` row until it is archived, and leagues
-- have to exist (and be "one per creator per season") before then.
--
-- Members, invites and removals key on accounts(id) — Tier 1 is who someone is.
-- Only approved players may manage; that is checked in the server actions.
--
-- Safe to run against a live DB: additive only. Seeds one open fantasy season
-- so leagues can be created; rename it below if you like.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists fantasy_seasons (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  status     text        not null default 'open'
             check (status in ('open', 'drafting', 'active', 'complete')),
  created_at timestamptz not null default now()
);

create table if not exists fantasy_leagues (
  id                uuid        primary key default gen_random_uuid(),
  fantasy_season_id uuid        not null references fantasy_seasons(id) on delete cascade,
  name              text        not null check (char_length(name) between 1 and 40),
  visibility        text        not null default 'public' check (visibility in ('public', 'private')),
  status            text        not null default 'pre_draft'
                    check (status in ('pre_draft', 'drafting', 'active', 'complete', 'disbanded')),
  -- created_by never changes, so "one league per creator per season" survives the
  -- commissioner seat passing to someone else when the creator leaves.
  created_by        uuid        not null references accounts(id) on delete cascade,
  commissioner_id   uuid        not null references accounts(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (fantasy_season_id, created_by)
);

create table if not exists fantasy_league_members (
  league_id  uuid        not null references fantasy_leagues(id) on delete cascade,
  account_id uuid        not null references accounts(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (league_id, account_id)
);

create table if not exists fantasy_league_invites (
  league_id  uuid        not null references fantasy_leagues(id) on delete cascade,
  account_id uuid        not null references accounts(id) on delete cascade,
  invited_by uuid        not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, account_id)
);

-- A manager the commissioner removed can't walk straight back into a public
-- league. Re-inviting him clears the row.
create table if not exists fantasy_league_removals (
  league_id  uuid        not null references fantasy_leagues(id) on delete cascade,
  account_id uuid        not null references accounts(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (league_id, account_id)
);

create index if not exists fantasy_league_members_account_idx on fantasy_league_members(account_id);
create index if not exists fantasy_league_invites_account_idx on fantasy_league_invites(account_id);

-- RLS on with no policies: anon and authenticated are denied, service_role
-- (supabaseAdmin, which every app read and write uses) bypasses it.
alter table fantasy_seasons         enable row level security;
alter table fantasy_leagues         enable row level security;
alter table fantasy_league_members  enable row level security;
alter table fantasy_league_invites  enable row level security;
alter table fantasy_league_removals enable row level security;

-- Joining is check-then-insert against the manager cap, so it runs under a row
-- lock on the league: two players taking the last seat at once would otherwise
-- both see room and both get in.
create or replace function public.fantasy_join_league(p_league uuid, p_account uuid, p_cap int)
returns text
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  perform 1 from fantasy_leagues where id = p_league and status = 'pre_draft' for update;
  if not found then return 'closed'; end if;
  if exists (select 1 from fantasy_league_members where league_id = p_league and account_id = p_account) then
    return 'already';
  end if;
  select count(*) into n from fantasy_league_members where league_id = p_league;
  if n >= p_cap then return 'full'; end if;
  insert into fantasy_league_members (league_id, account_id) values (p_league, p_account);
  delete from fantasy_league_invites where league_id = p_league and account_id = p_account;
  return 'ok';
end;
$$;

-- Supabase publishes every public function at /rest/v1/rpc/ and Postgres grants
-- EXECUTE to PUBLIC by default — revoked so the anon key can't join anyone to
-- anything. Only app/dashboard/fantasy/actions.ts calls it, via supabaseAdmin.
revoke execute on function public.fantasy_join_league(uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.fantasy_join_league(uuid, uuid, int) to service_role;

insert into fantasy_seasons (name)
select 'Fantasy Season'
where not exists (select 1 from fantasy_seasons where status <> 'complete');
