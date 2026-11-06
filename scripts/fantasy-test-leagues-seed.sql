-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — test leagues for previewing the hub and league pages
--
-- Run in the Supabase SQL editor after scripts/fantasy-leagues-migration.sql.
-- Creates 12 Tier 1 test accounts (discord_id test_fantasy_NN) and six leagues
-- in the current fantasy season covering every card state: public / private,
-- empty-ish, partly filled, full at the manager cap, drafting and active.
--
-- Set me_discord below to your own Discord ID to also receive two invites (one
-- public, one private) so the Invites section and the green "Invite Only"
-- button show. You are never made a member, so the hub doesn't redirect you
-- into a single league. Left as-is, the invites are skipped.
--
-- Cleanup (also done by Admin → Remove test users, since it deletes test_%
-- accounts and everything here cascades from them):
--   delete from accounts where discord_id like 'test_fantasy_%';
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  me_discord text := 'YOUR_DISCORD_ID';
  season uuid;
  cap int;
  me uuid;
  a uuid[];
  l uuid;
begin
  select id into season from fantasy_seasons where status <> 'complete' order by created_at desc limit 1;
  if season is null then
    raise exception 'No open fantasy season. Run scripts/fantasy-leagues-migration.sql first.';
  end if;
  if exists (select 1 from accounts where discord_id like 'test_fantasy_%') then
    raise exception 'Already seeded. Run the cleanup statement at the top first.';
  end if;

  -- Mirrors fantasyManagerCap in app/lib/fantasy-rules.ts.
  select case when num_teams between 1 and 21 then 4 else 6 end into cap from league_settings limit 1;
  cap := coalesce(cap, 6);

  select id into me from accounts where discord_id = me_discord;

  insert into accounts (discord_id, username, avatar, status, updated_at)
  select 'test_fantasy_' || lpad(i::text, 2, '0'), n, null, 'approved', now()
  from unnest(array[
    'AerialAndy', 'BoostBandit', 'CeilingCarl', 'DemoDana', 'FlipResetFin', 'GoalieGus',
    'HalfFlipHana', 'KickoffKai', 'MustyMo', 'PinchPete', 'RotateRae', 'WavedashWes'
  ]) with ordinality as t(n, i);

  a := array(select id from accounts where discord_id like 'test_fantasy_%' order by discord_id);

  -- Public, pre-draft, 3 managers. You're invited.
  insert into fantasy_leagues (fantasy_season_id, name, visibility, status, created_by, commissioner_id)
  values (season, 'Saturday Night Flips', 'public', 'pre_draft', a[1], a[1]) returning id into l;
  insert into fantasy_league_members (league_id, account_id, joined_at)
  select l, x, now() + o * interval '1 second' from unnest(a[1:3]) with ordinality u(x, o);
  if me is not null then
    insert into fantasy_league_invites (league_id, account_id, invited_by) values (l, me, a[1]);
  end if;

  -- Private, pre-draft, 2 managers. You're invited (green Invite Only).
  insert into fantasy_leagues (fantasy_season_id, name, visibility, status, created_by, commissioner_id)
  values (season, 'Ceiling Shot Society', 'private', 'pre_draft', a[4], a[4]) returning id into l;
  insert into fantasy_league_members (league_id, account_id, joined_at)
  select l, x, now() + o * interval '1 second' from unnest(a[4:5]) with ordinality u(x, o);
  if me is not null then
    insert into fantasy_league_invites (league_id, account_id, invited_by) values (l, me, a[4]);
  end if;

  -- Private, pre-draft, 3 managers, not invited (grey Invite Only).
  insert into fantasy_leagues (fantasy_season_id, name, visibility, status, created_by, commissioner_id)
  values (season, 'Wavedash Weekly', 'private', 'pre_draft', a[6], a[6]) returning id into l;
  insert into fantasy_league_members (league_id, account_id, joined_at)
  select l, x, now() + o * interval '1 second' from unnest(array[a[6], a[1], a[10]]) with ordinality u(x, o);

  -- Public, pre-draft, full at the manager cap.
  insert into fantasy_leagues (fantasy_season_id, name, visibility, status, created_by, commissioner_id)
  values (season, 'Full Boost Club', 'public', 'pre_draft', a[7], a[7]) returning id into l;
  insert into fantasy_league_members (league_id, account_id, joined_at)
  select l, x, now() + o * interval '1 second' from unnest(a[7:7 + cap - 1]) with ordinality u(x, o);

  -- Public, drafting, 4 managers.
  insert into fantasy_leagues (fantasy_season_id, name, visibility, status, created_by, commissioner_id)
  values (season, 'Demo Derby', 'public', 'drafting', a[2], a[2]) returning id into l;
  insert into fantasy_league_members (league_id, account_id, joined_at)
  select l, x, now() + o * interval '1 second' from unnest(array[a[2], a[5], a[8], a[11]]) with ordinality u(x, o);

  -- Private, active, 4 managers.
  insert into fantasy_leagues (fantasy_season_id, name, visibility, status, created_by, commissioner_id)
  values (season, 'Kickoff Kings', 'private', 'active', a[3], a[3]) returning id into l;
  insert into fantasy_league_members (league_id, account_id, joined_at)
  select l, x, now() + o * interval '1 second' from unnest(array[a[3], a[9], a[12], a[6]]) with ordinality u(x, o);
end $$;
