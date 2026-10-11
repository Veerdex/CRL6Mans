-- ─────────────────────────────────────────────────────────────
-- ADMIN — database size RPC
--
-- Exposes pg_database_size() as a callable function so the admin dashboard's
-- Storage & Limits section can show live Postgres database size against the
-- Supabase free-tier cap. supabase-js has no raw SQL escape hatch, so this
-- has to be an RPC.
--
-- Safe to run against a live DB — pure additive function creation.
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_database_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

-- Postgres grants EXECUTE to PUBLIC by default and Supabase publishes every
-- public function at /rest/v1/rpc/, so the grant below was not what made this
-- callable — it was already callable by the anon key, and being SECURITY
-- DEFINER it ran as the owner, around RLS. Verified against production: it
-- answered an anon call with HTTP 200. Only storage-section.tsx calls it, via
-- supabaseAdmin, so the revoke costs the dashboard nothing.
revoke execute on function public.get_database_size_bytes() from public, anon, authenticated;
grant  execute on function public.get_database_size_bytes() to service_role;
