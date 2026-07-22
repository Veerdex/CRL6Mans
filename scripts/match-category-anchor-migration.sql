-- Discord category ID new match-stage categories get positioned right after.
-- Set via the /setmatchcategoryanchor slash command.
--
-- When null, new categories keep Discord's default behavior of appending to the
-- bottom of the channel list — this column is purely additive.
alter table league_settings add column if not exists match_category_anchor_id text;
