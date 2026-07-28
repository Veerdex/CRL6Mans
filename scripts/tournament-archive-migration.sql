-- Adds the full downloadable/re-viewable archive column to completed
-- tournaments and archived seasons. Run manually in the Supabase SQL editor.

alter table tournaments add column if not exists full_archive jsonb;
alter table seasons add column if not exists full_archive jsonb;
