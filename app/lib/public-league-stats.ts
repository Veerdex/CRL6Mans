import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchAllRows } from "@/app/lib/paginate";
import { getGuildCounts } from "@/app/lib/discord-api";

/**
 * League history for the stats panel on /login.
 *
 * Aggregate counts only — no usernames, no display names, no Discord ids. That
 * page is unauthenticated, and the champions, record holders and leaderboards
 * all sit behind the login wall, so nothing here may name a player.
 *
 * The four Summer League seasons finished before the site existed, so their
 * scoreboard rows live in `seeded_player_stats` keyed on event_id. The live
 * machinery folds finished seasons into `player_career_stats` instead, and the
 * seeded table is deliberately kept out of that roll-up, so the two sum without
 * double-counting.
 */

type EventRow = {
  event_kind: string | null;
  event_id: string;
  ended_at: string | null;
  discord_id: string | null;
  team_count: number | null;
  participant_count: number | null;
  prize_pool: number | null;
};

type SeededRow = {
  event_id: string;
  games: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  demos: number | null;
};

type CareerRow = Omit<SeededRow, "event_id" | "games">;

export type Scoreboard = {
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  games: number;
};

export type PublicLeagueStats = {
  seasons: number;
  tournaments: number;
  firstSeasonYear: number | null;
  playersAllTime: number;
  latestSeason: { year: number; teams: number } | null;
  prizePool: number;
  scoreboard: Scoreboard;
  /** Set only when demos start later than the first season, so the tile can say so. */
  demosTrackedFrom: number | null;
  discordMembers: number | null;
  sixMans: { players: number; series: number } | null;
};

// Two backfilled rows are keyed by a roster name rather than a Discord id,
// because the id was not known when the season was seeded. One of them is a
// player who appears under their snowflake in three other seasons, so counting
// the key as-is would both double-count them and let a `test_` id through if a
// test event ever writes here.
const SNOWFLAKE = /^\d{15,22}$/;

const yearOf = (iso: string | null): number | null => (iso ? Number(iso.slice(0, 4)) : null);

const sum = (a: number, b: number | null) => a + (Number(b) || 0);

// `seeded_player_stats.games` is per player — it is the divisor behind MVP and
// every per-game column — so summing it counts each game once per player in the
// lobby. The lobby size comes from the event's own shape rather than a hardcoded
// 6, so a seeded 2v2 season would divide by 4 instead of silently reading 50%
// low. Seasons are always 3v3 today, which is the fallback.
function lobbySize(event: { teams: number | null; participants: number | null }): number {
  const perTeam =
    event.teams && event.participants ? Math.round(event.participants / event.teams) : 0;
  return perTeam >= 1 && perTeam <= 3 ? perTeam * 2 : 6;
}

/**
 * The server's private 6mans queue, run by the queue bot into its own
 * `crl6mansqueuebot_*` tables. Counted rather than fetched, so the figures
 * cannot silently cap at PostgREST's 1000-row page — series is already past 300.
 * Void series are excluded: those are the ones that never finished.
 */
async function fetchSixMans(): Promise<{ players: number; series: number } | null> {
  const [players, series] = await Promise.all([
    supabaseAdmin
      .from("crl6mansqueuebot_players")
      .select("id", { count: "exact", head: true })
      .eq("is_test_data", false),
    supabaseAdmin
      .from("crl6mansqueuebot_series")
      .select("id", { count: "exact", head: true })
      .eq("is_test_data", false)
      .eq("status", "reported"),
  ]);
  if (players.error || series.error) {
    console.error("[publicLeagueStats] 6mans count failed", players.error ?? series.error);
    return null;
  }
  return { players: players.count ?? 0, series: series.count ?? 0 };
}

async function computePublicLeagueStats(): Promise<PublicLeagueStats> {
  const [events, seeded, career, sixMans, guild] = await Promise.all([
    fetchAllRows<EventRow>((from, to) =>
      supabaseAdmin
        .from("player_event_results")
        .select("event_kind, event_id, ended_at, discord_id, team_count, participant_count, prize_pool")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<SeededRow>((from, to) =>
      supabaseAdmin
        .from("seeded_player_stats")
        .select("event_id, games, goals, assists, saves, shots, demos")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<CareerRow>((from, to) =>
      supabaseAdmin
        .from("player_career_stats")
        .select("goals, assists, saves, shots, demos")
        .order("player_id")
        .range(from, to)
    ),
    fetchSixMans(),
    getGuildCounts(),
  ]);

  const byEvent = new Map<
    string,
    { kind: string | null; endedAt: string | null; teams: number | null; participants: number | null; prize: number }
  >();
  const players = new Set<string>();
  for (const row of events) {
    if (row.discord_id && SNOWFLAKE.test(row.discord_id)) players.add(row.discord_id);
    if (byEvent.has(row.event_id)) continue;
    byEvent.set(row.event_id, {
      kind: row.event_kind,
      endedAt: row.ended_at,
      teams: row.team_count,
      participants: row.participant_count,
      prize: Number(row.prize_pool) || 0,
    });
  }

  // A season, not the latest event: the 2v2 Monthly finished after the 2026
  // season did, so sorting every event by ended_at would make "teams last
  // season" read 7.
  const seasons = [...byEvent.entries()]
    .filter(([, e]) => e.kind === "season")
    .sort((a, b) => String(a[1].endedAt).localeCompare(String(b[1].endedAt)));
  const newest = seasons[seasons.length - 1];
  const newestYear = newest ? yearOf(newest[1].endedAt) : null;

  // A test tournament can never land here: completeTournament archives one for
  // staff export but deliberately skips recordEventResults, and
  // rebuildEventResults filters is_test so a backfill can't put it back.
  const tournaments = [...byEvent.values()].filter((e) => e.kind === "tournament").length;

  const perEvent = new Map<string, { games: number; demos: number }>();
  const scoreboard: Scoreboard = { goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, games: 0 };
  for (const row of seeded) {
    scoreboard.goals = sum(scoreboard.goals, row.goals);
    scoreboard.assists = sum(scoreboard.assists, row.assists);
    scoreboard.saves = sum(scoreboard.saves, row.saves);
    scoreboard.shots = sum(scoreboard.shots, row.shots);
    scoreboard.demos = sum(scoreboard.demos, row.demos);
    const agg = perEvent.get(row.event_id) ?? { games: 0, demos: 0 };
    agg.games = sum(agg.games, row.games);
    agg.demos = sum(agg.demos, row.demos);
    perEvent.set(row.event_id, agg);
  }
  for (const [eventId, agg] of perEvent) {
    const event = byEvent.get(eventId);
    scoreboard.games += Math.round(agg.games / (event ? lobbySize(event) : 6));
  }
  for (const row of career) {
    scoreboard.goals = sum(scoreboard.goals, row.goals);
    scoreboard.assists = sum(scoreboard.assists, row.assists);
    scoreboard.saves = sum(scoreboard.saves, row.saves);
    scoreboard.shots = sum(scoreboard.shots, row.shots);
    scoreboard.demos = sum(scoreboard.demos, row.demos);
  }

  // The oldest season recorded no demos at all — that is missing data, not a
  // season nobody bumped anyone in — so the tile has to say which year the
  // count really starts from rather than sit under a "since 2023" heading.
  const firstSeasonYear = seasons.length ? yearOf(seasons[0][1].endedAt) : null;
  const firstDemoSeason = seasons.find(([id]) => (perEvent.get(id)?.demos ?? 0) > 0);
  const demoYear = firstDemoSeason ? yearOf(firstDemoSeason[1].endedAt) : null;

  return {
    seasons: seasons.length,
    tournaments,
    firstSeasonYear,
    playersAllTime: players.size,
    latestSeason: newest && newestYear ? { year: newestYear, teams: newest[1].teams ?? 0 } : null,
    prizePool: [...byEvent.values()].reduce((total, e) => total + e.prize, 0),
    scoreboard,
    demosTrackedFrom: demoYear && demoYear !== firstSeasonYear ? demoYear : null,
    discordMembers: guild?.members ?? null,
    sixMans,
  };
}

// /login is public, so the action behind this panel is an endpoint anyone can
// call. The window keeps a burst of opens down to one set of queries and one
// Discord call. Only a success is stored — memoising a thrown read would pin
// "0 seasons, 0 players" to the page for the whole window.
const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; value: PublicLeagueStats } | null = null;

export async function getPublicLeagueStats(): Promise<PublicLeagueStats> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await computePublicLeagueStats();
  cached = { at: Date.now(), value };
  return value;
}
