-- Custom Name Glint benefit (name-glint).
--
-- Two to four colours the patron picks, stored in pick order because the order
-- is what the sweep animates through. jsonb rather than text[] to match
-- patreon_benefit_prefs: supabase-js round-trips it as a plain JS array, and
-- the shape is validated on both write and read anyway (app/lib/name-glint.ts),
-- so a column type that also enforced the count would only duplicate that.
--
-- Null means "not picked yet", which is distinct from the benefit being off:
-- an enabled glint with no colours falls back to the solid Colored Name rather
-- than stripping it.
--
-- This column is read by the dashboard layout on every page render, so apply
-- this before deploying: a missing column makes the whole select fail, which
-- also silently drops the supporter badge, name colour and avatar border.

alter table accounts add column if not exists patreon_name_glint jsonb;
