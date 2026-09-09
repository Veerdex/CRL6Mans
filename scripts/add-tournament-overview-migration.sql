-- Free-form markdown blurb shown at the top of a tournament's Overview tab.
-- Null or empty means the tab renders exactly as it did before.
alter table tournaments add column if not exists overview text;
