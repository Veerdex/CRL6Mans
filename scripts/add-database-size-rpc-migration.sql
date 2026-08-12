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

grant execute on function public.get_database_size_bytes() to service_role;
