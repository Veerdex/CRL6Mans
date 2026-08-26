-- Per-tab, per-visit log for the admin "Tab Visits" analytics section.
-- Run this in the Supabase SQL editor.

create table if not exists tab_visits (
  id bigint generated always as identity primary key,
  tab text not null,
  created_at timestamptz not null default now()
);

create index if not exists tab_visits_tab_created_at_idx on tab_visits (tab, created_at);
