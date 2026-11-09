import "server-only";
import { supabaseAdmin } from "./supabase";
import { accountName } from "./fantasy-leagues";
import { getMatchupData, type ManagerWeek } from "./fantasy-matchup-server";
import { getPoolView, type PoolPlayer } from "./fantasy-pool-data";
import { draftPicks, rosterSlots } from "./fantasy-draft-server";
import { notifyManagers } from "./fantasy-notify";
import { FANTASY_SEASON_NAME_MAX } from "./fantasy-rules";
import {
  completionNotices,
  lineupsToEntries,
  placedStandings,
  withoutDetail,
  type ArchivedPerson,
  type FantasyArchive,
  type FantasyArchiveLeague,
  type FantasyLeagueDetail,
  type FantasyLeagueSummary,
} from "./fantasy-archive";

// The season end (docs/fantasy-rl.md §15). Completing the real event moves the
// running fantasy season to `ended` with a snapshot of everything its pages
// draw, since the reset that follows deletes the matches it scores from.
// Exporting the event's archive moves it on to `complete`.

const RUNNING = ["drafting", "active"];

type EventKind = "tournament" | "season";

export type FantasySnapshot = { archive: FantasyArchive; endedAt: string };

/**
 * Everything an ended season's pages and export need, read while the matches
 * still exist. Null when no season is in play, or for a test run, which
 * rollbackFantasyTestRun undoes instead.
 */
export async function snapshotFantasySeason(): Promise<FantasySnapshot | null> {
  const { data: season } = await supabaseAdmin
    .from("fantasy_seasons")
    .select("id, name, test_run")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season || season.test_run) return null;

  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id, name, visibility")
    .eq("fantasy_season_id", season.id)
    .eq("status", "active")
    .order("created_at");
  const endedAt = new Date().toISOString();
  const leagues: FantasyArchiveLeague[] = [];
  for (const l of (leagueRows ?? []) as { id: string; name: string; visibility: "public" | "private" }[]) {
    leagues.push({ leagueId: l.id, name: l.name, visibility: l.visibility, summary: await snapshotLeague(l.id, season.name as string, endedAt) });
  }
  return { archive: { seasonId: season.id as string, seasonName: season.name as string, leagues }, endedAt };
}

async function snapshotLeague(leagueId: string, seasonName: string, endedAt: string): Promise<FantasyLeagueSummary> {
  const [matchup, pool, slots, picks] = await Promise.all([
    getMatchupData(leagueId, true, null),
    getPoolView(leagueId, true),
    rosterSlots(leagueId),
    draftPicks(leagueId),
  ]);
  const playerById = new Map(pool.players.map((p) => [p.id, p]));
  const { data: accountRows } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, username, display_name")
    .in("id", [...new Set([...matchup.managers, ...slots.map((s) => s.player_id), ...picks.map((p) => p.player_id)])]);
  const accounts = new Map(
    ((accountRows ?? []) as { id: string; discord_id: string | null; username: string | null; display_name: string | null }[]).map((a) => [a.id, a]),
  );
  const person = (id: string): ArchivedPerson => {
    const a = accounts.get(id);
    return { id, discordId: a?.discord_id ?? null, name: accountName(a), username: a?.username ?? null };
  };

  // The per-match projections are what the live tab measured against; the
  // ended tab only needs the projection already set on each line.
  const slim = (p: PoolPlayer | null): PoolPlayer | null => {
    if (!p) return null;
    const { matchProjected: _m, ...rest } = p;
    void _m;
    return rest;
  };
  for (const week of matchup.lineups.values()) {
    for (const mw of week.values()) {
      for (const line of [...mw.starters, ...mw.bench]) line.player = slim(line.player);
    }
  }

  return {
    seasonName,
    endedAt,
    managers: matchup.managers.map(person),
    standings: placedStandings(matchup.schedule),
    champion: matchup.schedule.champion,
    detail: {
      schedule: matchup.schedule,
      lineups: lineupsToEntries(matchup.lineups),
      rosters: slots.map((s) => ({
        managerId: s.manager_id,
        slot: s.slot,
        player: person(s.player_id),
        seasonPoints: playerById.get(s.player_id)?.seasonPoints ?? 0,
      })),
      draft: picks.map((p) => ({ pick: p.pick_no, managerId: p.manager_id, player: person(p.player_id), auto: p.auto })),
    },
  };
}

/** The snapshot's lineups as the matchup tab takes them; lineupsToEntries wrote them from ManagerWeek. */
export function lineupsFromEntries(entries: FantasyLeagueDetail["lineups"]): Map<number, Map<string, ManagerWeek>> {
  return new Map(entries.map(([week, managers]) => [week, new Map(managers as [string, ManagerWeek][])]));
}

/**
 * Step 1 of §15: the season and its leagues leave `active`, which freezes every
 * mutator, the waiver run, the notice sweep and the credits, and the season is
 * tied to the event whose export will complete it.
 */
export async function endFantasySeason(snapshot: FantasySnapshot, eventKind: EventKind, eventId: string): Promise<void> {
  const { archive, endedAt } = snapshot;
  for (const l of archive.leagues) {
    const { error } = await supabaseAdmin
      .from("fantasy_leagues")
      .update({ status: "ended", summary: l.summary })
      .eq("id", l.leagueId)
      .eq("status", "active");
    if (error) console.error(`[fantasy] ending league ${l.leagueId} failed: ${error.message}`);
  }
  await supabaseAdmin
    .from("fantasy_seasons")
    .update({ status: "ended", event_kind: eventKind, event_id: eventId, ended_at: endedAt })
    .eq("id", archive.seasonId)
    .eq("status", "active");
}

/**
 * The event ended with no archive (Cancel Tournament, Reset Season): a running
 * season and its leagues are cancelled and nothing is kept. A season still
 * `open` is waiting on a draft, possibly for the next event, so it stays.
 */
export async function cancelRunningFantasySeason(): Promise<void> {
  const { data } = await supabaseAdmin.from("fantasy_seasons").select("id, test_run").in("status", RUNNING);
  const ids = ((data ?? []) as { id: string; test_run: boolean | null }[]).filter((s) => !s.test_run).map((s) => s.id);
  if (!ids.length) return;
  await supabaseAdmin.from("fantasy_leagues").update({ status: "cancelled" }).in("fantasy_season_id", ids).in("status", ["pre_draft", ...RUNNING]);
  await supabaseAdmin.from("fantasy_seasons").update({ status: "cancelled" }).in("id", ids).in("status", RUNNING);
}

async function seasonForEvent(eventKind: EventKind, eventId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("fantasy_seasons")
    .select("id")
    .eq("event_kind", eventKind)
    .eq("event_id", eventId)
    .eq("status", "ended")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Step 2 of §15, from purgeExportedArchive once the JSON is on disk: the season
 * is complete, each league keeps only its summary, and every manager hears how
 * it finished. The status claim makes it run once.
 */
export async function completeFantasyForEvent(eventKind: EventKind, eventId: string): Promise<void> {
  const seasonId = await seasonForEvent(eventKind, eventId);
  if (!seasonId) return;
  const { data: claimed } = await supabaseAdmin
    .from("fantasy_seasons")
    .update({ status: "complete" })
    .eq("id", seasonId)
    .eq("status", "ended")
    .select("id");
  if (!claimed?.length) return;

  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id, name, summary")
    .eq("fantasy_season_id", seasonId)
    .eq("status", "ended");
  for (const l of (leagueRows ?? []) as { id: string; name: string; summary: FantasyLeagueSummary | null }[]) {
    await supabaseAdmin
      .from("fantasy_leagues")
      .update({ status: "complete", summary: l.summary ? withoutDetail(l.summary) : null })
      .eq("id", l.id);
    if (!l.summary) continue;
    for (const n of completionNotices(l.name, l.summary)) {
      notifyManagers([n.to], "fantasy_results", { title: n.title, body: n.body, url: `/dashboard/fantasy/${l.id}` });
    }
  }
}

/** The event's archive was deleted unexported, so the season it held can never complete. */
export async function cancelFantasyForEvent(eventKind: EventKind, eventId: string): Promise<void> {
  const seasonId = await seasonForEvent(eventKind, eventId);
  if (!seasonId) return;
  await supabaseAdmin.from("fantasy_leagues").update({ status: "cancelled" }).eq("fantasy_season_id", seasonId).eq("status", "ended");
  await supabaseAdmin.from("fantasy_seasons").update({ status: "cancelled" }).eq("id", seasonId).eq("status", "ended");
}

/** The league summaries the event's PDF report draws its fantasy page from. */
export async function fantasySummariesForEvent(
  eventKind: EventKind,
  eventId: string,
): Promise<{ name: string; summary: FantasyLeagueSummary }[]> {
  const { data: season } = await supabaseAdmin
    .from("fantasy_seasons")
    .select("id")
    .eq("event_kind", eventKind)
    .eq("event_id", eventId)
    .in("status", ["ended", "complete"])
    .maybeSingle();
  if (!season) return [];
  const { data } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("name, summary")
    .eq("fantasy_season_id", season.id)
    .in("status", ["ended", "complete"])
    .not("summary", "is", null)
    .order("created_at");
  return ((data ?? []) as { name: string; summary: FantasyLeagueSummary }[]).map((l) => ({ name: l.name, summary: withoutDetail(l.summary) }));
}

/**
 * Opens the next fantasy season for leagues to form in. One at a time: an
 * `ended` season doesn't block it, since that one only waits on an export.
 */
export async function openFantasySeason(rawName: string): Promise<{ error?: string; message?: string }> {
  const name = rawName.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the season a name." };
  if (name.length > FANTASY_SEASON_NAME_MAX) return { error: `Season names are at most ${FANTASY_SEASON_NAME_MAX} characters.` };
  const { count } = await supabaseAdmin
    .from("fantasy_seasons")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", ...RUNNING]);
  if (count) return { error: "A fantasy season is already open or running." };
  const { error } = await supabaseAdmin.from("fantasy_seasons").insert({ name, status: "open" });
  if (error) return { error: `Couldn't open the season: ${error.message}` };
  return { message: `${name} is open. Leagues can form now.` };
}
