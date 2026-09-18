-- Run this in the Supabase SQL editor.
--
-- Backs the contribution score shown beside each name in Staff Management.
-- One row per qualifying staff action, +1 each; the score is just a count.
--
-- A log rather than a counter column on staff_roles, for two reasons.
-- removeStaffMember DELETEs the staff_roles row, so a moderator who is removed
-- and re-added would come back at zero. And a count with no rows behind it can
-- never be re-derived if the qualifying set changes — with the log, it can.
--
-- Keyed on discord_id with no foreign key, the same way season_accolades and
-- player_event_results are: the actor may not have a players row at all, and a
-- contribution should outlive the staff_roles row it was earned under.

create table if not exists staff_contributions (
  id          uuid        primary key default gen_random_uuid(),
  discord_id  text        not null,
  action      text        not null,
  subject_id  text,
  created_at  timestamptz not null default now()
);

-- The only read is "count per staff member", and the only write is an append.
create index if not exists staff_contributions_discord_id_idx
  on staff_contributions (discord_id);
