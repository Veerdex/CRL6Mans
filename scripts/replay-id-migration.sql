-- Store each replay's unique Id so duplicate replays can be rejected at upload.
alter table player_game_stats add column if not exists replay_id text;
create index if not exists player_game_stats_replay_idx on player_game_stats(replay_id);
