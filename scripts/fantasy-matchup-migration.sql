-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — slot credits (docs/fantasy-rl.md §6 and §14). Additive only.
--
-- Who filled a starting slot depends on the lineup at the moment a series was
-- reported, which can't be reconstructed later, so it is stored. Points are
-- not: they are computed on read from the credited match's player_game_stats.
--
-- The primary key is the "first score counts" rule: one credit per slot per
-- week, and an insert that loses a race (or comes later) is ignored.
-- team_id is the side the player played for, so the score can be read the
-- right way round after the player changes teams. Not a foreign key: teams go
-- at a season reset, and the matches cascade takes the credits with them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists fantasy_slot_credits (
  league_id   uuid        not null references fantasy_leagues(id) on delete cascade,
  manager_id  uuid        not null references accounts(id) on delete cascade,
  week        integer     not null check (week > 0),
  slot        text        not null,
  player_id   uuid        not null references accounts(id) on delete cascade,
  match_id    uuid        not null references matches(id) on delete cascade,
  team_id     uuid        not null,
  credited_at timestamptz not null default now(),
  primary key (league_id, manager_id, week, slot)
);

create index if not exists fantasy_slot_credits_match_idx on fantasy_slot_credits (match_id);

alter table fantasy_slot_credits enable row level security;
