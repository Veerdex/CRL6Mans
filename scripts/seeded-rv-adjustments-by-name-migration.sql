-- Replay-derived RV adjustments for past players whose Discord account was never
-- identified. Keyed on the in-game name they played under, so nothing applies them
-- automatically: an admin links one by hand once the person is known.
create table if not exists seeded_rv_adjustments_by_name (
  player_name      text             primary key,
  rv_adjustment    double precision not null,
  rv_series_played smallint         not null,
  source           text             not null,
  created_at       timestamptz      not null default now()
);

alter table seeded_rv_adjustments_by_name enable row level security;
