-- ─────────────────────────────────────────────────────────────────────────────
-- STATS-DRIVEN RV ADJUSTMENT
--
-- See app/lib/rv-adjustment.ts. A player's RV is their MMR rating plus
-- players.rv_adjustment; every stats-tracked series moves the adjustment toward
-- the RV their fantasy points implied, and rv_series_played (capped at 5 in code)
-- slows that as a player is measured over more series.
--
-- On Tier 3 `players`, not `pending_players`: RV only matters for someone who
-- can be rostered, and every rating read already selects from `players`.
--
-- player_rv_updates is one row per (match, player): the audit trail behind the
-- adjustment, and the dedupe that stops a re-run report from applying twice.
--
-- Safe to run against a live DB: additive only. Everyone starts at (0, 0), so
-- no displayed RV changes until the first stats-tracked series is reported.
-- ─────────────────────────────────────────────────────────────────────────────

alter table players
  add column if not exists rv_adjustment    double precision not null default 0,
  add column if not exists rv_series_played smallint         not null default 0;

create table if not exists player_rv_updates (
  match_id          uuid             not null references matches(id) on delete cascade,
  player_id         uuid             not null references players(id) on delete cascade,
  games             smallint         not null,
  predicted_fp      double precision not null,
  actual_fp         double precision not null,
  delta             double precision not null,
  adjustment_before double precision not null,
  adjustment_after  double precision not null,
  created_at        timestamptz      not null default now(),
  primary key (match_id, player_id)
);

-- Server-only, like every other table: supabaseAdmin bypasses RLS, anon sees nothing.
alter table player_rv_updates enable row level security;
