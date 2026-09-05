import "server-only";

import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./paginate";
import { eventPoints, type EventKind } from "./career-points";
import type { TournamentArchive } from "@/app/dashboard/admin/tournament-archive";

/**
 * Per-player event results.
 *
 * `player_event_results` is a derived index, not a second source of truth. The
 * canonical record of a finished event is the `full_archive` jsonb on
 * `tournaments`/`seasons`; every row here is reproducible from it, and
 * rebuildEventResults() regenerates the table from those archives. That is the
 * backfill path for any later fix to placement or to the shape of a row.
 *
 * It exists because a profile should be one indexed lookup on discord_id rather
 * than a scan of every archive in the league's history — the user's requirement
 * that a profile fetch only the player being viewed.
 *
 * Points are never stored, only the inputs they are computed from. See
 * app/lib/career-points.ts.
 */

export type EventResultRow = {
  event_kind: EventKind;
  event_id: string;
  event_name: string;
  ended_at: string | null;
  discord_id: string;
  username: string | null;
  display_name: string | null;
  placement: number;
  placement_tier_size: number;
  team_count: number;
  participant_count: number;
  prize_pool: number;
  team_name: string | null;
  teammates: { discordId: string | null; username: string; displayName: string | null }[];
};

export type EventHistoryEntry = EventResultRow & { points: number };

/** Flatten an archive into one row per rostered player. */
export function rowsFromArchive(
  eventId: string,
  archive: TournamentArchive,
): EventResultRow[] {
  const rows: EventResultRow[] = [];
  for (const team of archive.teams) {
    for (const player of team.roster) {
      // A player with no discord_id cannot be tied to an account, so there is
      // nothing a profile could do with the row. Archives written before schema
      // version 2 have none at all.
      if (!player.discordId) continue;
      rows.push({
        event_kind: archive.kind,
        event_id: eventId,
        event_name: archive.meta.name,
        ended_at: archive.meta.endedAt,
        discord_id: player.discordId,
        username: player.username,
        display_name: player.displayName,
        placement: team.placement,
        placement_tier_size: team.placementTierSize,
        team_count: archive.meta.teamCount,
        participant_count: archive.meta.participantCount,
        prize_pool: archive.meta.prizePool,
        team_name: team.name,
        teammates: team.roster
          .filter((mate) => mate.username !== player.username)
          .map((mate) => ({
            discordId: mate.discordId,
            username: mate.username,
            displayName: mate.displayName,
          })),
      });
    }
  }
  return rows;
}

/**
 * Write one finished event's results. Upserts on (event_kind, event_id,
 * discord_id) so re-running it — a rebuild, or a re-completed event — replaces
 * rather than duplicates.
 */
export async function recordEventResults(
  eventId: string,
  archive: TournamentArchive,
): Promise<{ rows: number }> {
  const rows = rowsFromArchive(eventId, archive);
  if (rows.length === 0) return { rows: 0 };

  const { error } = await supabaseAdmin
    .from("player_event_results")
    .upsert(rows, { onConflict: "event_kind,event_id,discord_id" });
  if (error) throw new Error(error.message);
  return { rows: rows.length };
}

/**
 * Regenerate the whole table from the archives. The backfill path for a
 * placement fix or a schema change: the archives hold everything, so this table
 * can always be thrown away and rebuilt.
 */
export async function rebuildEventResults(): Promise<{ events: number; rows: number }> {
  const [tournaments, seasons] = await Promise.all([
    fetchAllRows<{ id: string; full_archive: TournamentArchive | null }>((from, to) =>
      supabaseAdmin
        .from("tournaments")
        .select("id, full_archive")
        .not("full_archive", "is", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{ id: string; full_archive: TournamentArchive | null }>((from, to) =>
      supabaseAdmin
        .from("seasons")
        .select("id, full_archive")
        .not("full_archive", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);

  let events = 0;
  let rows = 0;
  for (const row of [...tournaments, ...seasons]) {
    if (!row.full_archive) continue;
    const written = await recordEventResults(row.id, row.full_archive);
    events++;
    rows += written.rows;
  }
  return { events, rows };
}

/** Every event one player has played, newest first, with points computed on read. */
export async function fetchEventHistory(discordId: string): Promise<EventHistoryEntry[]> {
  const { data, error } = await supabaseAdmin
    .from("player_event_results")
    .select("*")
    .eq("discord_id", discordId)
    .order("ended_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const result = row as EventResultRow;
    return {
      ...result,
      placement: Number(result.placement),
      points: eventPoints({
        placement: Number(result.placement),
        teamCount: result.team_count,
        prizePool: result.prize_pool,
        kind: result.event_kind,
      }),
    };
  });
}
