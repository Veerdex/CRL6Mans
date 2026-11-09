-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — season end (docs/fantasy-rl.md §15). Additive only.
--
-- New statuses, on both fantasy_seasons and fantasy_leagues:
--   ended      the real event was completed. The matches fantasy scored from are
--              gone, so the season is read-only and drawn from its snapshot,
--              which rides in the event's full_archive until it is exported.
--   cancelled  the event ended without an archive (Cancel Tournament, Reset
--              Season). Nothing is kept.
-- complete stays the final state, reached when the event's archive is exported.
--
-- fantasy_seasons.event_kind / event_id  the archived event (a tournaments or
--              seasons row) whose export completes this fantasy season. No FK:
--              it can point at either table, like player_event_results.
-- fantasy_leagues.summary  final standings and champion, kept after the
--              archive is purged so the league page and a PDF-only re-export
--              still have them.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fantasy_seasons drop constraint if exists fantasy_seasons_status_check;
alter table fantasy_seasons add constraint fantasy_seasons_status_check
  check (status in ('open', 'drafting', 'active', 'ended', 'complete', 'cancelled'));

alter table fantasy_leagues drop constraint if exists fantasy_leagues_status_check;
alter table fantasy_leagues add constraint fantasy_leagues_status_check
  check (status in ('pre_draft', 'drafting', 'active', 'ended', 'complete', 'disbanded', 'cancelled'));

alter table fantasy_seasons add column if not exists event_kind text check (event_kind in ('tournament', 'season'));
alter table fantasy_seasons add column if not exists event_id   uuid;
alter table fantasy_seasons add column if not exists ended_at   timestamptz;

alter table fantasy_leagues add column if not exists summary jsonb;

create index if not exists fantasy_seasons_event_idx on fantasy_seasons (event_kind, event_id);
