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
--      anon key. Verified: it answered an anon call with HTTP 200.
--
-- Safe to run against production, and safe to re-run. Everything in Part 2 is
-- already true there, so those statements are no-ops; Part 1 is the only line
-- that changes anything live. Run this last, after any other migration — it is
-- the backstop that makes a re-run of an older file harmless.
--
-- Verify with: node scripts/check-anon-exposure.mjs
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
alter table accounts                          enable row level security;
alter table analytics_events                  enable row level security;
alter table clip_likes                        enable row level security;
alter table clips                             enable row level security;
alter table crl_coin_transactions             enable row level security;
alter table designs                           enable row level security;
alter table event_accolade_prizes             enable row level security;
alter table game_scores                       enable row level security;
alter table league_settings                   enable row level security;
alter table match_discord_categories          enable row level security;
alter table match_identity_snapshots          enable row level security;
alter table matches                           enable row level security;
alter table notifications                     enable row level security;
alter table parlay_legs                       enable row level security;
alter table parlays                           enable row level security;
alter table patreon_tier_benefits             enable row level security;
alter table patreon_tier_prices               enable row level security;
alter table patreon_tier_roles                enable row level security;
alter table pending_players                   enable row level security;
alter table player_career_stats               enable row level security;
alter table player_edit_requests              enable row level security;
alter table player_event_results              enable row level security;
alter table player_game_stats                 enable row level security;
alter table player_platform_account_events    enable row level security;
alter table player_platform_accounts          enable row level security;
alter table players                           enable row level security;
alter table push_subscriptions                enable row level security;
alter table replay_identity_certifications    enable row level security;
alter table replay_identity_discrepancies     enable row level security;
alter table round_schedules                   enable row level security;
alter table season_accolades                  enable row level security;
alter table seasons                           enable row level security;
alter table seeded_player_stats               enable row level security;
alter table sponsor_members                   enable row level security;
alter table sponsors                          enable row level security;
alter table staff_contributions               enable row level security;
alter table staff_roles                       enable row level security;
alter table sub_requests                      enable row level security;
alter table tab_visits                        enable row level security;
alter table team_signup_members               enable row level security;
alter table team_signups                      enable row level security;
alter table teams                             enable row level security;
alter table themes                            enable row level security;
alter table tournament_entries                enable row level security;
alter table tournaments                       enable row level security;
alter table wager_balance_adjustments         enable row level security;
alter table wager_settlement_failures         enable row level security;
alter table wagers                            enable row level security;

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
-- Today that key reaches nobody. app/lib/supabase.ts exports an anon client and
-- nothing imports it — no "use client" file, no .channel() subscription — so
-- Next.js never inlines NEXT_PUBLIC_SUPABASE_ANON_KEY into a browser bundle.
-- The exposure is latent, not live. It goes live the moment any client component
-- imports that client, which is a realistic step if the draft page ever moves to
-- Supabase realtime.
--
-- Left in place because the question it turns on is not answerable from this
-- repo: does anything OUTSIDE it read `players` with the anon key? The queue bot
-- is the obvious candidate — it is a separate application against the same
-- database, and it is the likeliest reason this policy was added by hand. It has
-- its own crl6mansqueuebot_players table, which argues it does not need this
-- one, but that is inference.
--
-- If nothing external reads it, drop it — the website does not use it:
--
--   drop policy "Public read approved players" on players;
--
-- Reversible, and the way to find out is to drop it and watch the queue bot. Do
-- that outside a queue window, not during a live draft.
-- ─────────────────────────────────────────────
