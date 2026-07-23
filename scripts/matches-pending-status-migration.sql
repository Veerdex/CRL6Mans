-- Widens matches.status to allow "pending" for placeholder rows (null team_ids,
-- future-round slots pre-created before pairings are known). SE bracket generation
-- already relied on this value; schema.sql's original constraint never listed it.
alter table matches drop constraint if exists matches_status_check;
alter table matches add constraint matches_status_check check (status in ('pending', 'scheduled', 'completed', 'cancelled'));
