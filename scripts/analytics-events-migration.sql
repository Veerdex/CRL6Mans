-- Admin Insights: log app visits, registrations, and draft joins for 12-month charts.
create table if not exists analytics_events (
  id         uuid        primary key default gen_random_uuid(),
  type       text        not null check (type in ('visit', 'registration', 'draft_join')),
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_type_created_idx on analytics_events(type, created_at);

alter table analytics_events disable row level security;
