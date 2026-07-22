-- Collapses round_schedules.schedule_type from ("weekly" | "daily" | "specific")
-- down to ("range" | "specific"), with a new range_days column holding the window
-- length in days for "range" rows (null for "specific" — no window, just an instant).
alter table round_schedules add column if not exists range_days integer;

-- Relax any CHECK constraint on schedule_type before the backfill below writes
-- 'range' rows — otherwise the old ('specific'|'daily'|'weekly') constraint rejects
-- them. Drops by the conventional Postgres-generated name if present; adjust the
-- name here if your constraint was created with a custom name.
alter table round_schedules drop constraint if exists round_schedules_schedule_type_check;
alter table round_schedules add constraint round_schedules_schedule_type_check check (schedule_type in ('specific', 'range', 'daily', 'weekly'));

update round_schedules set schedule_type = 'range', range_days = 1 where schedule_type = 'daily';
update round_schedules set schedule_type = 'range', range_days = 7 where schedule_type = 'weekly';
update round_schedules set range_days = null where schedule_type = 'specific';

-- Now tighten the constraint down to the final two-value set.
alter table round_schedules drop constraint if exists round_schedules_schedule_type_check;
alter table round_schedules add constraint round_schedules_schedule_type_check check (schedule_type in ('specific', 'range'));
