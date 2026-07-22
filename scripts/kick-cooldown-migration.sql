-- Run this in the Supabase SQL editor.
--
-- Adds a temporary-cooldown option to the existing kick mechanism. Today
-- `kick_reason` is a permanent gate (checked with a bare truthiness test at
-- every eligibility call site). `kicked_until` lets a kick auto-expire: NULL
-- means "no expiry" (today's permanent-kick behavior, including the existing
-- ban path), a timestamp means the player becomes eligible again once it
-- passes.
--
-- Also extends the platform-account event log to support a ban-evasion flag
-- raised when a new claim's platform ID matches a HISTORICAL (not just
-- currently-active) row owned by a different, currently-kicked/banned player.

alter table players add column if not exists kicked_until timestamptz;

alter table player_platform_account_events
  drop constraint if exists player_platform_account_events_event_type_check;

alter table player_platform_account_events
  add constraint player_platform_account_events_event_type_check
  check (event_type in
    ('claimed', 'verification_submitted', 'verified', 'rejected',
     'withdrawn', 'revoked', 'corrected', 'note_added', 'ban_evasion_flagged'));
