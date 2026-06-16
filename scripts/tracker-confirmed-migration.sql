-- Tracker freshness: require players to update or confirm their tracker within a
-- week before joining a draft (tournament/season).
-- Records the last time tracker info was set, admin-approved, or confirmed unchanged.
alter table players add column if not exists tracker_confirmed_at timestamptz;
