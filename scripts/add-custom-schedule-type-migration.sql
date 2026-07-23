-- Adds "custom" as a new schedule_type. Structurally it's a window type (like
-- "range") with an admin-configurable day count, but every match in the round
-- requires the admin to set its time individually — team-proposed times always
-- need admin approval, regardless of whether they fall inside the window.
alter table round_schedules drop constraint if exists round_schedules_schedule_type_check;
alter table round_schedules add constraint round_schedules_schedule_type_check check (schedule_type in ('specific', 'range', 'weekly', 'custom'));
