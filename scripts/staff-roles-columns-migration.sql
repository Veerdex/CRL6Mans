-- Ensure Staff Management columns exist. The staff_roles table is the source of
-- truth for moderator/director/ceo; the admin UI reads/writes these extra fields.
create table if not exists staff_roles (
  discord_id  text        primary key,
  role        text        not null default 'moderator'
                          check (role in ('moderator', 'director', 'ceo')),
  username    text,
  added_by    text,
  created_at  timestamptz not null default now()
);

alter table staff_roles add column if not exists username   text;
alter table staff_roles add column if not exists added_by   text;
alter table staff_roles add column if not exists created_at timestamptz not null default now();
