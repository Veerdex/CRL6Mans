-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — lineup changes (docs/fantasy-rl.md §4 and §6). Additive only.
--
-- A lineup move is a swap of two slots, which plain updates can't do: unique
-- (league_id, player_id) and the (league, manager, slot) key are checked row by
-- row, so either half of the swap collides with the other. Deleting both rows
-- and reinserting them swapped, inside one function, commits it as one change.
--
-- Compare-and-swap on the two occupants, under the league's row lock, so a
-- stale page or a second tab gets 'stale' instead of moving the wrong player.
-- Whether the move is legal (tiers, locks) is decided by the caller against
-- app/lib/fantasy-lineup.ts. p_player_b is null for a move onto an empty slot.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fantasy_swap_slots(
  p_league uuid, p_manager uuid,
  p_slot_a text, p_player_a uuid,
  p_slot_b text, p_player_b uuid
)
returns text
language plpgsql
set search_path = public
as $$
begin
  perform 1 from fantasy_leagues where id = p_league and status = 'active' for update;
  if not found then return 'stale'; end if;

  if (select player_id from fantasy_roster_slots
        where league_id = p_league and manager_id = p_manager and slot = p_slot_a) is distinct from p_player_a
     or (select player_id from fantasy_roster_slots
        where league_id = p_league and manager_id = p_manager and slot = p_slot_b) is distinct from p_player_b
  then
    return 'stale';
  end if;

  delete from fantasy_roster_slots
    where league_id = p_league and manager_id = p_manager and slot in (p_slot_a, p_slot_b);
  insert into fantasy_roster_slots (league_id, manager_id, slot, player_id)
    values (p_league, p_manager, p_slot_b, p_player_a);
  if p_player_b is not null then
    insert into fantasy_roster_slots (league_id, manager_id, slot, player_id)
      values (p_league, p_manager, p_slot_a, p_player_b);
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.fantasy_swap_slots(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.fantasy_swap_slots(uuid, uuid, text, uuid, text, uuid) to service_role;
