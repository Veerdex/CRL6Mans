-- docs/fantasy-rl.md §10: trades are a director's switch rather than a constant.
-- Off by default, matching the constant it replaces.
alter table league_settings
  add column if not exists fantasy_trades_enabled boolean not null default false;
