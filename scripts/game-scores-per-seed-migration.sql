-- ─────────────────────────────────────────────
-- GAME SCORES → one row per player per game per daily seed
--
-- game_scores was built for Flappy Bird, which has one all-time best per player,
-- so discord_id alone was the primary key. Send It is scored per daily seed —
-- distances on different hills are not comparable, so an all-time board would
-- rank whoever drew the easiest terrain — which needs a row per seed.
--
-- `car` and `hue` are the livery the distance was driven in, drawn as a small
-- painted sprite on the board row. Nullable: Flappy has no car, and so does any
-- Send It row written before the columns existed.
--
-- Existing rows take the defaults, which is exactly where Flappy's belong:
-- game 'flappy', seed 0. The seed column is meaningless for a game that has no
-- seed, and 0 is outside the range getDailySeed can ever draw (1000 and up), so
-- it cannot collide with a real day.
-- ─────────────────────────────────────────────
begin;

alter table game_scores add column if not exists game text   not null default 'flappy';
alter table game_scores add column if not exists seed bigint not null default 0;
alter table game_scores add column if not exists car  integer;
alter table game_scores add column if not exists hue  integer;

-- Postgres's default name for the inline `primary key` in schema.sql. If this
-- drops nothing the constraint was named by hand — check it in Supabase before
-- the add below fails on the old one still being there.
alter table game_scores drop constraint if exists game_scores_pkey;
alter table game_scores add primary key (discord_id, game, seed);

-- The board's only query: one game, one seed, best first.
create index if not exists game_scores_board_idx on game_scores(game, seed, score desc);

commit;

notify pgrst, 'reload schema';
