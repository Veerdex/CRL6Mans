-- Once signups are closed they cannot be reopened manually. A latch flag records
-- that a deliberate close happened (distinct from the initial "never opened" state).
-- league_settings: manual season draft. tournaments: per-tournament signups.
-- Reset to false on season reset / new tournament so a fresh cycle can open again.
alter table league_settings add column if not exists draft_signups_closed boolean not null default false;
alter table tournaments     add column if not exists signups_closed       boolean not null default false;
