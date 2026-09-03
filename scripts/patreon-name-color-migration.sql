-- Colored Name benefit (colored-username).
--
-- The colour is a per-patron choice, not a per-tier value, so it cannot live in
-- patreon_tier_benefits.value the way featured-on-support-page's name size
-- does. It sits on accounts next to the other Tier 1 identity state.
--
-- patreon_name_outline is stored separately rather than folded into the colour
-- string because the outline is opt-in but its *colour* is not: it derives from
-- the picked colour's luminance (see app/lib/name-color.ts), so there is
-- nothing to store for it beyond on/off.
--
-- Both columns are read by the dashboard layout on every page render, so apply
-- this before deploying: a missing column makes the whole select fail, which
-- also silently drops the supporter badge.

alter table accounts add column if not exists patreon_name_color text;
alter table accounts add column if not exists patreon_name_outline boolean not null default false;
