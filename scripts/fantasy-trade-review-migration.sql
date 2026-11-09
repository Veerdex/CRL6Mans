-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — league review of accepted trades (docs/fantasy-rl.md §10). Additive.
--
-- An accepted trade no longer goes through at once: it sits in 'review' until
-- review_ends_at (24 hours), and every other manager may vote on it. Half or
-- more rejecting ends it as 'vetoed'; more than half accepting, or the window
-- running out, puts it through. The thresholds live in app/lib/fantasy-trades.ts.
--
-- fantasy_accept_trade takes a trade from 'pending' or 'review', so this can be
-- applied ahead of the code that sends trades to review.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fantasy_trades drop constraint if exists fantasy_trades_status_check;
alter table fantasy_trades add constraint fantasy_trades_status_check
  check (status in ('pending', 'review', 'accepted', 'rejected', 'cancelled', 'failed', 'vetoed'));

alter table fantasy_trades add column if not exists review_ends_at timestamptz;

-- One vote per manager per trade; a manager may change theirs while it's open.
create table if not exists fantasy_trade_votes (
  trade_id   uuid        not null references fantasy_trades(id) on delete cascade,
  account_id uuid        not null references accounts(id) on delete cascade,
  vote       text        not null check (vote in ('accept', 'reject')),
  created_at timestamptz not null default now(),
  primary key (trade_id, account_id)
);

alter table fantasy_trade_votes enable row level security;

create or replace function public.fantasy_accept_trade(
  p_trade uuid, p_receiver uuid,
  p_players uuid[],
  p_from_managers uuid[], p_from_slots text[],
  p_to_managers uuid[],   p_to_slots text[]
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_league uuid;
  v_found  int;
begin
  select league_id into v_league from fantasy_trades
    where id = p_trade and receiver_id = p_receiver and status in ('pending', 'review');
  if not found then return 'gone'; end if;

  perform 1 from fantasy_leagues where id = v_league and status = 'active' for update;
  if not found then return 'stale'; end if;
  perform 1 from fantasy_trades where id = p_trade and status in ('pending', 'review') for update;
  if not found then return 'gone'; end if;

  select count(*) into v_found from (
    select 1 from fantasy_roster_slots s
      join unnest(p_players, p_from_managers, p_from_slots) as m(player_id, manager_id, slot)
        on s.player_id = m.player_id and s.manager_id = m.manager_id and s.slot = m.slot
      where s.league_id = v_league
      for update of s
  ) locked;
  if v_found <> cardinality(p_players) then return 'stale'; end if;

  delete from fantasy_roster_slots where league_id = v_league and player_id = any(p_players);
  insert into fantasy_roster_slots (league_id, manager_id, slot, player_id)
    select v_league, m.manager_id, m.slot, m.player_id
      from unnest(p_players, p_to_managers, p_to_slots) as m(player_id, manager_id, slot);

  update fantasy_trades set status = 'accepted', resolved_at = now() where id = p_trade;
  update fantasy_trades set status = 'cancelled', note = 'A player in it was traded first.', resolved_at = now()
    where league_id = v_league and status in ('pending', 'review') and id <> p_trade
      and id in (select trade_id from fantasy_trade_items where player_id = any(p_players));

  return 'ok';
end;
$$;

revoke execute on function public.fantasy_accept_trade(uuid, uuid, uuid[], uuid[], text[], uuid[], text[]) from public, anon, authenticated;
grant  execute on function public.fantasy_accept_trade(uuid, uuid, uuid[], uuid[], text[], uuid[], text[]) to service_role;
