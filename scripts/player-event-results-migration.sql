-- One row per player per finished event: how they placed, who they played with,
-- and the inputs a career-points total is computed from. Run manually in the
-- Supabase SQL editor.
--
-- This table is a DERIVED INDEX, not a source of truth. Every column is
-- reproducible from the `full_archive` jsonb on `tournaments`/`seasons`, and
-- rebuildEventResults() in app/lib/event-results.ts regenerates the whole table
-- from those archives. It exists so a profile is one indexed lookup on
-- discord_id instead of a scan of every archive, and so it can be dropped and
-- rebuilt whenever the placement or points logic changes.
--
-- Points are deliberately NOT stored. The career-points constants are hand-tuned
-- and will be retuned; a points value frozen here at completion time could never
-- be corrected. Only the formula's inputs are persisted.

create table if not exists player_event_results (
  id uuid primary key default gen_random_uuid(),

  event_kind text not null check (event_kind in ('tournament', 'season')),
  event_id uuid not null,
  event_name text not null,
  ended_at timestamptz,

  discord_id text not null,
  username text,
  display_name text,

  -- Fractional for tied bands: a 3rd-4th finish is 3.5 across a tier of 2, a
  -- 9th-16th finish is 12.5 across a tier of 8. tier_size is what renders the
  -- band back as a label, since the midpoint alone cannot recover it.
  placement numeric not null,
  placement_tier_size integer not null default 1,

  -- N for the points formula: teams, not players. participant_count is the
  -- player headcount, shown on the profile but not part of the math.
  team_count integer not null,
  participant_count integer not null default 0,

  -- f for the points formula, in CRL coins: 1st + 2nd + 2 x 3rd-4th.
  prize_pool integer not null default 0,

  team_name text,
  -- [{ discordId, username, displayName }] for the rest of the roster.
  teammates jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  unique (event_kind, event_id, discord_id)
);

-- The profile lookup: every event one player has played, newest first.
create index if not exists player_event_results_discord_id_idx
  on player_event_results (discord_id, ended_at desc);
