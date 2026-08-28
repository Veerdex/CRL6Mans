-- Per-game demolition counts, parsed from the replay's network stream
-- alongside the existing header-based stats (score, goals, assists, etc).
alter table player_game_stats add column if not exists demos integer not null default 0;
alter table player_game_stats add column if not exists demoed integer not null default 0;
