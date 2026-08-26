-- Stores the full Rules page/tab content as a single markdown document,
-- editable by Directors+. Null means "use the hardcoded default" in
-- app/dashboard/rules/rules-default.ts; a non-null value overrides it in full.
alter table league_settings add column if not exists rules_markdown text;
