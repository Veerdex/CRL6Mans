-- Re-adds "weekly" as a distinct schedule_type (previously collapsed into "range"
-- with range_days = 7 by schedule-range-migration.sql). Unlike a plain 7-day range,
-- "weekly" is validated at save time to only start on the day after the league's
-- configured match_deadline_day, so admins can rebuild the old weekly cadence
-- without it drifting onto arbitrary start days.
alter table round_schedules drop constraint if exists round_schedules_schedule_type_check;
alter table round_schedules add constraint round_schedules_schedule_type_check check (schedule_type in ('specific', 'range', 'weekly'));
