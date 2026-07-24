alter table teams add column if not exists is_disqualified boolean not null default false;
alter table teams add column if not exists disqualified_at timestamptz;
