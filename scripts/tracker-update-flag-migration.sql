-- Per-player flag set when an admin forces all active event participants to
-- re-verify their Rocket League tracker. Cleared when the player re-confirms /
-- updates their tracker, or automatically when the event ends (resetSeason).
alter table players add column if not exists must_update_tracker boolean not null default false;
