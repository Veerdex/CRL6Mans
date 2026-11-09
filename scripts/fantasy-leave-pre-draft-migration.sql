-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — a manager leaving before the draft (docs/fantasy-rl.md §11).
--
-- Starting the drafts flips each league to 'drafting' and then reads its
-- members to seat the draft order. A leave that checked 'pre_draft' just before
-- the flip and deleted just after it left a seat in the order with nobody in it.
-- Like fantasy_join_league, this locks the league row while it is still
-- pre_draft, so the leave and the flip can't interleave.
--
-- Returns { outcome, heir }:
--   closed   the league is no longer pre_draft; nothing changed
--   gone     the account wasn't a member; nothing changed
--   emptied  the last manager left, so the league was deleted
--   ok       the manager is out; heir is the new owner if ownership passed
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fantasy_leave_pre_draft(p_league uuid, p_account uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  owner uuid;
  heir uuid;
begin
  select commissioner_id into owner from fantasy_leagues where id = p_league and status = 'pre_draft' for update;
  if not found then return jsonb_build_object('outcome', 'closed'); end if;

  delete from fantasy_league_members where league_id = p_league and account_id = p_account;
  if not found then return jsonb_build_object('outcome', 'gone'); end if;

  if not exists (select 1 from fantasy_league_members where league_id = p_league) then
    delete from fantasy_leagues where id = p_league;
    return jsonb_build_object('outcome', 'emptied');
  end if;

  if owner = p_account then
    select account_id into heir from fantasy_league_members where league_id = p_league order by joined_at limit 1;
    update fantasy_leagues set commissioner_id = heir where id = p_league;
  end if;
  return jsonb_build_object('outcome', 'ok', 'heir', heir);
end;
$$;

revoke execute on function public.fantasy_leave_pre_draft(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fantasy_leave_pre_draft(uuid, uuid) to service_role;
