-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — trades (docs/fantasy-rl.md §10). Additive only.
--
-- fantasy_trades       one proposal from one manager to another: pending, then
--                      accepted / rejected / cancelled / failed (a player left
--                      his roster before it was accepted).
-- fantasy_trade_items  the players in it and whose roster each comes from. No
--                      slots: a lineup move after proposing changes them, so the
--                      slots are paired at acceptance (app/lib/fantasy-trades.ts).
--
-- fantasy_accept_trade moves every player at once. Plain updates can't: the
-- incoming player is still on the other roster, so unique (league_id, player_id)
-- collides. It deletes every outgoing row before inserting any incoming one,
-- under the league's row lock (which serialises it against lineup moves) and
-- with the outgoing rows locked, since adds and the waiver run don't take the
-- league lock. Parallel arrays: player i leaves (from_manager i, from_slot i)
-- for (to_manager i, to_slot i). Whether the trade is legal (tiers, locks,
-- membership) is decided by the caller.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists fantasy_trades (
  id          uuid        primary key default gen_random_uuid(),
  league_id   uuid        not null references fantasy_leagues(id) on delete cascade,
  proposer_id uuid        not null references accounts(id) on delete cascade,
  receiver_id uuid        not null references accounts(id) on delete cascade,
  status      text        not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'failed')),
  note        text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check (proposer_id <> receiver_id)
);

create table if not exists fantasy_trade_items (
  trade_id        uuid not null references fantasy_trades(id) on delete cascade,
  player_id       uuid not null references accounts(id) on delete cascade,
  from_manager_id uuid not null references accounts(id) on delete cascade,
  primary key (trade_id, player_id)
);

create index if not exists fantasy_trades_league_idx      on fantasy_trades (league_id, status);
create index if not exists fantasy_trade_items_player_idx on fantasy_trade_items (player_id);

alter table fantasy_trades      enable row level security;
alter table fantasy_trade_items enable row level security;

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
    where id = p_trade and receiver_id = p_receiver and status = 'pending';
  if not found then return 'gone'; end if;

  perform 1 from fantasy_leagues where id = v_league and status = 'active' for update;
  if not found then return 'stale'; end if;
  perform 1 from fantasy_trades where id = p_trade and status = 'pending' for update;
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
    where league_id = v_league and status = 'pending' and id <> p_trade
      and id in (select trade_id from fantasy_trade_items where player_id = any(p_players));

  return 'ok';
end;
$$;

revoke execute on function public.fantasy_accept_trade(uuid, uuid, uuid[], uuid[], text[], uuid[], text[]) from public, anon, authenticated;
grant  execute on function public.fantasy_accept_trade(uuid, uuid, uuid[], uuid[], text[], uuid[], text[]) to service_role;
