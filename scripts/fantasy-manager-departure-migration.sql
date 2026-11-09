-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — a manager leaving after the draft (docs/fantasy-rl.md §11).
-- Additive only.
--
-- fantasy_league_members.orphaned_at  set when the manager left, was removed,
--     kicked or banned once the draft had started. The row keeps its account_id,
--     since every fantasy table keys a team by it and the schedule is built from
--     the member list: the team stays, keeps scoring, and keeps its seat.
-- fantasy_league_invites.takeover_of  an invite to take over that orphaned
--     team rather than to join the league.
-- fantasy_hand_over_team  moves the orphaned team onto its new manager.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fantasy_league_members add column if not exists orphaned_at timestamptz;
alter table fantasy_league_invites add column if not exists takeover_of uuid references accounts(id) on delete cascade;

-- Re-keys the team from p_from to p_to in one transaction, so a team is never
-- half under each id. joined_at is kept: the round robin is seated from it.
-- Every column that holds a manager id is here; the commissioner never needs
-- moving, since an orphan can't be the owner.
create or replace function public.fantasy_hand_over_team(p_league uuid, p_from uuid, p_to uuid)
returns text
language plpgsql
set search_path = public
as $$
begin
  -- Not while drafting: fantasy_draft_pick takes its manager from a read made
  -- before its lock, so a pick could land under the old id after the move.
  -- The draft autopicks an orphan's turns, and the hand-over waits for it.
  perform 1 from fantasy_leagues where id = p_league and status = 'active' for update;
  if not found then return 'closed'; end if;
  perform 1 from fantasy_league_members
    where league_id = p_league and account_id = p_from and orphaned_at is not null for update;
  if not found then return 'taken'; end if;
  if not exists (select 1 from fantasy_league_invites where league_id = p_league and account_id = p_to and takeover_of = p_from) then
    return 'no_invite';
  end if;
  if exists (select 1 from fantasy_league_members where league_id = p_league and account_id = p_to) then
    return 'member';
  end if;
  if exists (select 1 from fantasy_roster_slots where league_id = p_league and player_id = p_to) then
    return 'rostered';
  end if;

  -- A manager leaves the pool, so a claim filed on them as a player can't settle.
  update fantasy_waiver_claims
    set status = 'cancelled', note = 'That player became a manager in this league.', resolved_at = now()
    where league_id = p_league and player_id = p_to and status = 'pending';

  update fantasy_league_members set account_id = p_to, orphaned_at = null where league_id = p_league and account_id = p_from;
  update fantasy_roster_slots   set manager_id = p_to where league_id = p_league and manager_id = p_from;
  update fantasy_slot_credits   set manager_id = p_to where league_id = p_league and manager_id = p_from;
  update fantasy_draft_picks    set manager_id = p_to where league_id = p_league and manager_id = p_from;
  update fantasy_waiver_claims  set manager_id = p_to where league_id = p_league and manager_id = p_from;
  update fantasy_trades         set proposer_id = p_to where league_id = p_league and proposer_id = p_from;
  update fantasy_trades         set receiver_id = p_to where league_id = p_league and receiver_id = p_from;
  update fantasy_trade_items    set from_manager_id = p_to
    where from_manager_id = p_from and trade_id in (select id from fantasy_trades where league_id = p_league);
  update fantasy_leagues
    set draft_order  = array_replace(draft_order, p_from, p_to),
        waiver_order = array_replace(waiver_order, p_from, p_to)
    where id = p_league;
  -- Every offer of this team goes, so a second one can't be accepted too.
  delete from fantasy_league_invites where league_id = p_league and (takeover_of = p_from or account_id = p_to);
  return 'ok';
end;
$$;

revoke execute on function public.fantasy_hand_over_team(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fantasy_hand_over_team(uuid, uuid, uuid) to service_role;
