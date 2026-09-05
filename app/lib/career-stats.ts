import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchAllRows } from "@/app/lib/paginate";

export type CareerTotals = {
  games: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
  demos: number;
  demoed: number;
};

const ZERO: CareerTotals = { games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0, demos: 0, demoed: 0 };

type LiveRow = {
  player_id: string;
  goals: number; assists: number; saves: number; shots: number; score: number;
  demos: number | null; demoed: number | null;
};

type CareerRow = CareerTotals & { player_id: string };

function fetchLiveRows() {
  return fetchAllRows<LiveRow>((from, to) =>
    supabaseAdmin
      .from("player_game_stats")
      .select("player_id, goals, assists, saves, shots, score, demos, demoed")
      .not("player_id", "is", null)
      .order("match_id")
      .order("game_number")
      .range(from, to)
  );
}

function addRow(t: CareerTotals, r: LiveRow) {
  t.games += 1;
  t.goals += r.goals;
  t.assists += r.assists;
  t.saves += r.saves;
  t.shots += r.shots;
  t.score += r.score;
  t.demos += r.demos ?? 0;
  t.demoed += r.demoed ?? 0;
}

/**
 * Fold every live player_game_stats row into the permanent all-time table.
 *
 * Must run at the very top of resetSeason(), before anything that can throw and
 * before `matches` is deleted: player_game_stats.match_id cascades on that
 * delete, so once the matches are gone the event's stats are unrecoverable.
 * Consumed rows are deleted so a retried reset cannot double-count them.
 */
export async function rollUpCareerStats(): Promise<void> {
  const rows = await fetchLiveRows();
  if (!rows.length) return;

  const byPlayer = new Map<string, CareerTotals>();
  for (const r of rows) {
    let t = byPlayer.get(r.player_id);
    if (!t) byPlayer.set(r.player_id, (t = { ...ZERO }));
    addRow(t, r);
  }
  const playerIds = [...byPlayer.keys()];

  const { data: existing } = await supabaseAdmin
    .from("player_career_stats")
    .select("player_id, games, goals, assists, saves, shots, score, demos, demoed")
    .in("player_id", playerIds);
  const priorById = new Map((existing ?? []).map((e: CareerRow) => [e.player_id, e]));

  const merged = [...byPlayer.entries()].map(([playerId, t]) => {
    const p = priorById.get(playerId);
    return {
      player_id: playerId,
      games: (p?.games ?? 0) + t.games,
      goals: (p?.goals ?? 0) + t.goals,
      assists: (p?.assists ?? 0) + t.assists,
      saves: (p?.saves ?? 0) + t.saves,
      shots: (p?.shots ?? 0) + t.shots,
      score: (p?.score ?? 0) + t.score,
      demos: (p?.demos ?? 0) + t.demos,
      demoed: (p?.demoed ?? 0) + t.demoed,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabaseAdmin
    .from("player_career_stats")
    .upsert(merged, { onConflict: "player_id" });
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("player_game_stats").delete().in("player_id", playerIds);
}

/**
 * All-time totals per player: the rolled-up table plus whatever the live event
 * has produced so far, so All Time always includes the event in progress.
 */
export async function fetchAllTimeTotals(): Promise<Map<string, CareerTotals>> {
  const [career, live] = await Promise.all([
    fetchAllRows<CareerRow>((from, to) =>
      supabaseAdmin
        .from("player_career_stats")
        .select("player_id, games, goals, assists, saves, shots, score, demos, demoed")
        .order("player_id")
        .range(from, to)
    ),
    fetchLiveRows(),
  ]);

  const totals = new Map<string, CareerTotals>();
  for (const c of career) {
    totals.set(c.player_id, {
      games: c.games, goals: c.goals, assists: c.assists, saves: c.saves,
      shots: c.shots, score: c.score, demos: c.demos, demoed: c.demoed,
    });
  }
  for (const r of live) {
    let t = totals.get(r.player_id);
    if (!t) totals.set(r.player_id, (t = { ...ZERO }));
    addRow(t, r);
  }
  return totals;
}

/**
 * Whether the live event tracks per-game stats. Mirrored onto league_settings by
 * activateTournamentRuntime and reset to true when a tournament ends, so a manual
 * season (which always tracks stats) reads true without special-casing.
 */
export async function isStatsTrackingEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("league_settings").select("stats_enabled").single();
  return data?.stats_enabled ?? true;
}

export async function hasAnyCareerStats(): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("player_career_stats")
    .select("*", { count: "exact", head: true })
    .limit(1);
  return (count ?? 0) > 0;
}
