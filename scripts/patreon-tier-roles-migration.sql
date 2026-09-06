-- Connects a Patreon tier to a Discord role, replacing the single
-- league_settings.supporter_role_id and the older convention of matching a
-- guild role whose *name* equalled the tier title.
--
-- The row stores the role's id, not its name, so renaming the role in Discord
-- keeps the connection. It's keyed by tier_title (same key as
-- patreon_tier_benefits and patreon_tier_prices) rather than by the tier number
-- shown in /admin setsupporterrole, because that number is only a position in
-- the price-sorted list and shifts whenever a tier is added or repriced.
--
-- Free tiers are never connected: they grant no Discord role.

create table if not exists patreon_tier_roles (
  tier_title text        primary key,
  role_id    text        not null,
  updated_at timestamptz not null default now()
);

alter table patreon_tier_roles disable row level security;
