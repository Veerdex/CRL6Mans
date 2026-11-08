-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — draft, frozen tiers and rosters (slice 2)
--
-- See docs/fantasy-rl.md §3, §4 and §8. Additive only, safe on a live DB.
--
-- fantasy_player_tiers  the season's draftable pool, frozen when an admin starts
--                       the drafts: a tier is fixed for the season no matter what
--                       (§3), and rating is the autopick order (§8).
-- fantasy_leagues       gains the draft state: the randomized order (round 1),
--                       the pick on the clock and its deadline.
-- fantasy_draft_picks   one row per pick; unique player per league.
-- fantasy_roster_slots  the one current lineup (§4): one row per slot, eight per
--                       manager, a player on at most one roster per league.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists fantasy_player_tiers (
  fantasy_season_id uuid        not null references fantasy_seasons(id) on delete cascade,
  player_id         uuid        not null references accounts(id) on delete cascade,
  tier              smallint    not null check (tier between 1 and 3),
  rating            numeric     not null default 0,
  primary key (fantasy_season_id, player_id)
);

alter table fantasy_leagues add column if not exists draft_order   uuid[];
alter table fantasy_leagues add column if not exists current_pick  int not null default 0;
alter table fantasy_leagues add column if not exists pick_deadline timestamptz;

create table if not exists fantasy_draft_picks (
  league_id  uuid        not null references fantasy_leagues(id) on delete cascade,
  pick_no    int         not null,
  manager_id uuid        not null references accounts(id) on delete cascade,
  player_id  uuid        not null references accounts(id) on delete cascade,
  auto       boolean     not null default false,
  picked_at  timestamptz not null default now(),
  primary key (league_id, pick_no),
  unique (league_id, player_id)
);

create table if not exists fantasy_roster_slots (
  league_id  uuid not null references fantasy_leagues(id) on delete cascade,
  manager_id uuid not null references accounts(id) on delete cascade,
  slot       text not null check (slot in ('cap', 'first1', 'first2', 'second1', 'second2', 'flex', 'bench1', 'bench2')),
  player_id  uuid not null references accounts(id) on delete cascade,
  primary key (league_id, manager_id, slot),
  unique (league_id, player_id)
);

create index if not exists fantasy_leagues_drafting_idx on fantasy_leagues(pick_deadline) where status = 'drafting';

alter table fantasy_player_tiers enable row level security;
alter table fantasy_draft_picks  enable row level security;
alter table fantasy_roster_slots enable row level security;

-- A pick is compare-and-swap on current_pick under a row lock, so a manager's
-- pick and an autopick racing for the same turn can't both land: the loser
-- reads 'stale'. The pick, its roster slot and the advance commit together.
-- Who is on the clock, pool membership, the tier limit and the slot are decided
-- by the caller (app/lib/fantasy-draft.ts) against a read taken before the lock;
-- the CAS is what makes that read still true here, since nothing else changes a
-- drafting league's order or rosters.
create or replace function public.fantasy_draft_pick(
  p_league uuid, p_pick int, p_manager uuid, p_player uuid, p_slot text,
  p_auto boolean, p_total int, p_seconds int
)
returns text
language plpgsql
set search_path = public
as $$
declare
  done boolean := p_pick + 1 >= p_total;
begin
  perform 1 from fantasy_leagues
    where id = p_league and status = 'drafting' and current_pick = p_pick
    for update;
  if not found then return 'stale'; end if;

  begin
    insert into fantasy_draft_picks (league_id, pick_no, manager_id, player_id, auto)
      values (p_league, p_pick, p_manager, p_player, p_auto);
    insert into fantasy_roster_slots (league_id, manager_id, slot, player_id)
      values (p_league, p_manager, p_slot, p_player);
  exception when unique_violation then
    return 'taken';
  end;

  update fantasy_leagues set
    current_pick  = p_pick + 1,
    pick_deadline = case when done then null else now() + make_interval(secs => p_seconds) end,
    status        = case when done then 'active' else status end
  where id = p_league;

  return case when done then 'done' else 'ok' end;
end;
$$;

revoke execute on function public.fantasy_draft_pick(uuid, int, uuid, uuid, text, boolean, int, int) from public, anon, authenticated;
grant  execute on function public.fantasy_draft_pick(uuid, int, uuid, uuid, text, boolean, int, int) to service_role;
