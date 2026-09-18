-- Run this in the Supabase SQL editor.
--
-- Adds the switch behind "Require admin approval for claimed accounts" at the
-- top of the Registrations & Platform Claims tab.
--
-- Defaults to true because that is the behaviour that already shipped: every
-- claim has always waited on an admin. The application reads this column with
-- a `?? true` fallback as well, so the pre-migration state (column absent, or
-- null on an existing row) is also treated as ON. There is no arrangement of
-- this migration running late that silently loosens verification.

alter table league_settings
  add column if not exists claim_approval_required boolean not null default true;

-- league_settings is a single-row table; an existing row predates the column
-- and takes the default, but be explicit rather than relying on that.
update league_settings set claim_approval_required = true where claim_approval_required is null;
