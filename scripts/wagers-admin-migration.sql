-- Admin-side management for Westside Wages (players.crl_coins). Before this,
-- the only lever was a testing-only full reset — no visibility into balances
-- and no way to correct one player or the whole league without wiping
-- everyone to zero.
--
-- One row per affected player per adjustment, grouped by batch_id so a bulk
-- operation (apply to every approved player at once) reads as a single
-- action in the audit log while staying fully granular in the DB. A single-
-- player adjustment gets its own batch_id via the column default.
create table if not exists wager_balance_adjustments (
  id                uuid        primary key default gen_random_uuid(),
  batch_id          uuid        not null default gen_random_uuid(),
  scope             text        not null check (scope in ('single', 'bulk')),
  player_id         uuid        not null references players(id) on delete cascade,
  requested_amount  integer     not null,
  amount            integer     not null,
  balance_after     integer     not null,
  reason            text        not null,
  actor             text        not null,
  created_at        timestamptz not null default now()
);

create index if not exists wager_balance_adjustments_batch_id_idx   on wager_balance_adjustments(batch_id);
create index if not exists wager_balance_adjustments_player_id_idx  on wager_balance_adjustments(player_id);
create index if not exists wager_balance_adjustments_created_at_idx on wager_balance_adjustments(created_at);

alter table wager_balance_adjustments disable row level security;
