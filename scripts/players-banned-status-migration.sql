-- players.status has only ever allowed ('pending', 'approved', 'rejected') —
-- it predates the tiered account model and was never widened when banning
-- moved to accounts.status. banPlayer() mirrors accounts.status='banned' onto
-- the Tier 3 (players) row for the same reason approvePlayerWithEdits already
-- mirrors MMR/tracker fields there (see the comment in
-- app/dashboard/admin/player-actions.ts): several call sites that predate the
-- tier model still filter on players.status directly instead of joining
-- accounts — pushToAllApproved/pushToTeam/pushToEnteredDraft in app/lib/push.ts,
-- computeTopStats in app/lib/game-stats.ts, and the champion-roster ban check
-- in app/dashboard/podium/page.tsx. Without this, a banned player's Tier 3 row
-- stays stuck at status='approved' forever, so they keep receiving push
-- notifications and keep appearing on stat leaderboards/podiums after a ban.
--
-- Constraint name assumed as the Postgres default for an inline column CHECK
-- (<table>_<column>_check) — adjust if the live constraint was named explicitly.
alter table players drop constraint if exists players_status_check;
alter table players add constraint players_status_check
  check (status in ('pending', 'approved', 'rejected', 'banned'));
