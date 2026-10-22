-- ─────────────────────────────────────────────
-- GAME SCORES → let a player hold more than one row
--
-- game-scores-per-seed-migration.sql moved the primary key to
-- (discord_id, game, seed), which is what every query and both upserts target.
-- What it missed is that the Flappy-only table had carried `discord_id text
-- unique` as well — a separate constraint, named game_scores_discord_id_key,
-- which the primary-key drop left standing.
--
-- So the key said one row per player per game per seed and the table still
-- enforced one row per player, full stop. The second row a player ever earns is
-- refused with 23505, which saveSendItScore reports as false, the route answers
-- 503, and the game draws as "could not reach the board" — so a Send It run by
-- anyone who had ever played Flappy was never saved, and neither was a second
-- day's run by anyone.
--
-- The name is not a guess at Postgres's default: it is the one the live table
-- gave up in the 23505 this was found by. `if exists` only so the file can be
-- run twice.
--
-- The live table also still has the `id uuid` column that schema.sql no longer
-- declares, left behind when the same migration dropped game_scores_pkey off
-- it. Nothing reads or writes it and it keeps its default, so it is left alone
-- rather than dropped for tidiness.
-- ─────────────────────────────────────────────
begin;

alter table game_scores drop constraint if exists game_scores_discord_id_key;

commit;

notify pgrst, 'reload schema';
