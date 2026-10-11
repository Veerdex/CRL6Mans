-- Make 'topbar' (tabs across the top with a bottom bar) the default desktop
-- navigation layout, and move every existing account onto it.
--
-- The code change that goes with this flips every fallback so that anything
-- other than a stored 'sidebar' resolves to 'topbar', and renames the mirrored
-- cookie to nav_layout_v2 — without the rename, a reader's year-long
-- nav_layout=sidebar cookie is read before their account row and would keep
-- them on the old chrome until their next login.
--
-- Tier 1 (accounts) is the source of truth; the players copy is a legacy mirror
-- that some not-yet-migrated call sites still read, so both are written.

alter table accounts alter column nav_layout set default 'topbar';
alter table players  alter column nav_layout set default 'topbar';

update accounts
   set nav_layout = 'topbar',
       updated_at = now()
 where nav_layout is distinct from 'topbar';

update players
   set nav_layout = 'topbar'
 where nav_layout is distinct from 'topbar';

-- Expect both counts to be 0 afterwards.
select
  (select count(*) from accounts where nav_layout is distinct from 'topbar') as accounts_not_topbar,
  (select count(*) from players  where nav_layout is distinct from 'topbar') as players_not_topbar;
