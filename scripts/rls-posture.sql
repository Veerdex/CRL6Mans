-- ─────────────────────────────────────────────
-- RLS POSTURE — the backstop, and the audit that proves it
--
-- Supabase publishes every table in the `public` schema at /rest/v1/<table>,
-- authorized by NEXT_PUBLIC_SUPABASE_ANON_KEY. RLS is the only barrier: the
-- anon role holds SELECT and UPDATE grants on all 75 tables, which is Supabase's
-- default and not a misconfiguration, but it does mean policies are the entire
-- security boundary.
--
-- Three things made that boundary fragile:
--   1. Sixteen app tables had no `enable row level security` statement anywhere
--      in scripts/ — including accounts, pending_players, staff_roles, and all
--      three wager tables. `create table` defaults RLS off, so a fresh database
--      built from these scripts came up with the most sensitive tables open.
--      Production has them on because someone enabled them by hand.
--   2. Forty-one statements across fourteen files read `disable row level
--      security`, on the reasoning that the app uses the service-role key
--      exclusively. True, but backwards — service_role bypasses RLS, so that is
--      an argument for RLS being free, not for turning it off. Re-running any
--      one of those files would have stripped RLS from its tables. They now all
--      read `enable`.
--   3. get_database_size_bytes was SECURITY DEFINER with EXECUTE still granted
--      to PUBLIC, so it ran as its owner, around RLS, for anyone holding the
--      anon key. Verified: it answered an anon call with HTTP 200. Low severity
--      on its own — it returns one number, the database size, and can reach no
--      row — but it is the whole class that matters: the next SECURITY DEFINER
--      function someone adds is open by default too, and the next one may read
--      rows. Part 3d is the standing check for that.
--
-- Safe to run against production, and safe to re-run. Everything in Part 2 is
-- already true there, so those statements are no-ops; Part 1 is the only thing
-- in this file that changes anything live. Run this last, after any other
-- migration — it is the backstop that makes a re-run of an older file harmless.
--
-- Part 2 uses `alter table if exists` because four of these tables (wagers,
-- parlays, parlay_legs, round_schedules) were created by hand and exist in no
-- script here. Without `if exists` this file would fail on a fresh database —
-- and since the editor runs it as one transaction, that failure would roll back
-- Part 1 as well, which is the only part that does anything on production.
--
-- Run Parts 3a–3d one statement at a time. The SQL editor shows only the last
-- result set when several statements run together, so running the file whole
-- would hide 3c and 3a behind 3d's empty result.
--
-- Then verify from outside with: node scripts/check-anon-exposure.mjs
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- PART 1 — close the SECURITY DEFINER hole.
--
-- The only caller is app/dashboard/admin/storage-section.tsx, through
-- supabaseAdmin (service role), so the dashboard does not notice.
-- ─────────────────────────────────────────────
revoke execute on function public.get_database_size_bytes() from public, anon, authenticated;
grant  execute on function public.get_database_size_bytes() to service_role;

-- ─────────────────────────────────────────────
-- PART 2 — RLS on, with no policies, for every app table.
--
-- No policy means default-deny for anon and authenticated, while service_role
-- bypasses RLS entirely. Every read and write in the app goes through
-- supabaseAdmin, so nothing needs a policy to keep working.
--
-- The crl6mansqueuebot_* tables are deliberately absent: they belong to a
-- separate application that does read them with the anon key, through 27
-- hand-made `using (true)` SELECT policies. Not ours to change.
-- ─────────────────────────────────────────────
alter table if exists accounts enable row level security;
alter table if exists analytics_events enable row level security;
alter table if exists clip_likes enable row level security;
alter table if exists clips enable row level security;
alter table if exists crl_coin_transactions enable row level security;
alter table if exists designs enable row level security;
alter table if exists event_accolade_prizes enable row level security;
alter table if exists game_scores enable row level security;
alter table if exists league_settings enable row level security;
alter table if exists match_discord_categories enable row level security;
alter table if exists match_identity_snapshots enable row level security;
alter table if exists matches enable row level security;
alter table if exists notifications enable row level security;
alter table if exists parlay_legs enable row level security;
alter table if exists parlays enable row level security;
alter table if exists patreon_tier_benefits enable row level security;
alter table if exists patreon_tier_prices enable row level security;
alter table if exists patreon_tier_roles enable row level security;
alter table if exists pending_players enable row level security;
alter table if exists player_career_stats enable row level security;
alter table if exists player_edit_requests enable row level security;
alter table if exists player_event_results enable row level security;
alter table if exists player_game_stats enable row level security;
alter table if exists player_platform_account_events enable row level security;
alter table if exists player_platform_accounts enable row level security;
alter table if exists players enable row level security;
alter table if exists push_subscriptions enable row level security;
alter table if exists replay_identity_certifications enable row level security;
alter table if exists replay_identity_discrepancies enable row level security;
alter table if exists round_schedules enable row level security;
alter table if exists season_accolades enable row level security;
alter table if exists seasons enable row level security;
alter table if exists seeded_player_stats enable row level security;
alter table if exists sponsor_members enable row level security;
alter table if exists sponsors enable row level security;
alter table if exists staff_contributions enable row level security;
alter table if exists staff_roles enable row level security;
alter table if exists sub_requests enable row level security;
alter table if exists tab_visits enable row level security;
alter table if exists team_signup_members enable row level security;
alter table if exists team_signups enable row level security;
alter table if exists teams enable row level security;
alter table if exists themes enable row level security;
alter table if exists tournament_entries enable row level security;
alter table if exists tournaments enable row level security;
alter table if exists wager_balance_adjustments enable row level security;
alter table if exists wager_settlement_failures enable row level security;
alter table if exists wagers enable row level security;

-- ─────────────────────────────────────────────
-- PART 3 — the audit. Read-only; run it after Parts 1 and 2.
-- ─────────────────────────────────────────────

-- 3a. Every table, its RLS flag, and what anon is granted. Expect
--     relrowsecurity = true on every row. anon_select/anon_update being true is
--     Supabase's default grant and is fine on its own; it is only a finding when
--     a permissive policy sits behind it.
select relname, relrowsecurity,
       has_table_privilege('anon', oid, 'select') as anon_select,
       has_table_privilege('anon', oid, 'update') as anon_update
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relrowsecurity, relname;

-- 3b. Every policy anon can fall under. A policy written without a TO clause
--     gets roles = {public}, which includes anon, so both have to be matched.
--     Expect SELECT-only. Any row whose cmd is ALL/INSERT/UPDATE/DELETE with a
--     qual of `true` is a write hole.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (roles @> '{anon}' or roles @> '{public}')
order by (cmd <> 'SELECT') desc, tablename;

-- 3c. Views and materialized views. A view runs as its owner unless
--     security_invoker is set, so a view over accounts routes around every
--     policy above; a materialized view has no RLS at all. Expect no rows.
select relname, relkind, reloptions
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind in ('v', 'm')
  and has_table_privilege('anon', oid, 'select');

-- 3d. SECURITY DEFINER functions anon can execute. These run as their owner and
--     bypass RLS, and Postgres grants EXECUTE to PUBLIC by default, so a new one
--     is open until explicitly revoked. Expect no rows once Part 1 has run.
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and prosecdef
  and has_function_privilege('anon', oid, 'execute');

-- ─────────────────────────────────────────────
-- PART 4 — the one decision that needs a human.
--
-- `players` carries a hand-made policy:
--     "Public read approved players"  SELECT  {public}  using (status = 'approved')
--
-- So anyone holding the anon key can read every approved player's row: discord
-- snowflake, display name, MMR, team_id, is_captain, draft_entered. Pending,
-- rejected and banned rows are filtered out, so ban_reason and kick_reason are
-- not reachable through it.
--
-- The exposure is latent rather than live, and this was checked in both
-- applications that share this Supabase project — the anon key belongs to the
-- project, not to one app, so checking only this one would have proved nothing:
--
--   CRL6Mans           app/lib/supabase.ts exports an anon client and nothing
--                      imports it. No "use client" file, no .channel()
--                      subscription.
--   CRL6MansQueueBot   web/lib/supabase/{server,admin}.ts both begin with
--                      `import "server-only"`. The two client components that
--                      reach into lib/supabase take `import type` only, which
--                      erases at compile time.
--
-- Neither project's client bundle contains the key, so Next.js is not inlining
-- NEXT_PUBLIC_SUPABASE_ANON_KEY anywhere a browser can see it. It goes live the
-- moment any client component imports an anon client — a realistic step if the
-- draft page ever moves to Supabase realtime.
--
-- The queue bot also never reads this table; it has its own
-- crl6mansqueuebot_players. So nothing known reads `players` with the anon key,
-- and dropping the policy should be safe:
--
--   drop policy "Public read approved players" on players;
--
-- Not dropped here because this file is meant to be a no-op on production apart
-- from Part 1, and because "nothing known" is not "nothing" — the 27
-- `using (true)` policies on the crl6mansqueuebot_* tables were made by hand by
-- someone, for some client, and that intent is not recorded anywhere in either
-- repo. Reversible either way. Do it outside a queue window, not during a live
-- draft, and watch the queue bot afterwards.
-- ─────────────────────────────────────────────
