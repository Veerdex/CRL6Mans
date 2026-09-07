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
 * Must run immediately before resetSeason() deletes `matches`:
 * player_game_stats.match_id cascades on that delete, so once the matches are
 * gone the event's stats are unrecoverable. Consumed rows are deleted here so a
 * reset that throws part-way and gets retried cannot double-count them.
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

type SeededRow = CareerTotals & { discord_id: string };

/**
 * Scoreboard totals for seasons that finished before the site existed, seeded by
 * scripts/seed-past-season.mjs --stats and keyed on discord_id with no foreign
 * key. Rows for players who have not joined resolve to nothing and simply wait.
 */
function fetchSeededRows() {
  return fetchAllRows<SeededRow>((from, to) =>
    supabaseAdmin
      .from("seeded_player_stats")
      .select("discord_id, games, goals, assists, saves, shots, score, demos, demoed")
      .order("discord_id")
      .range(from, to)
  );
}

/**
 * Approved only, matching what the stats page renders: a seeded row belonging to
 * a banned account must not surface totals the rest of the page filters out.
 */
async function resolvePlayerIds(discordIds: string[]): Promise<Map<string, string>> {
  const byDiscordId = new Map<string, string>();
  for (let i = 0; i < discordIds.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("players")
      .select("id, discord_id")
      .eq("status", "approved")
      .in("discord_id", discordIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as { id: string; discord_id: string | null }[]) {
      if (p.discord_id) byDiscordId.set(p.discord_id, p.id);
    }
  }
  return byDiscordId;
}

/**
 * All-time totals per player: the rolled-up table, the seeded past seasons, and
 * whatever the live event has produced so far, so All Time always includes the
 * event in progress.
 */
export async function fetchAllTimeTotals(): Promise<Map<string, CareerTotals>> {
  const [career, live, seeded] = await Promise.all([
    fetchAllRows<CareerRow>((from, to) =>
      supabaseAdmin
        .from("player_career_stats")
        .select("player_id, games, goals, assists, saves, shots, score, demos, demoed")
        .not("player_id", "is", null)
        .order("player_id")
        .range(from, to)
    ),
    fetchLiveRows(),
    fetchSeededRows(),
  ]);

  const totals = new Map<string, CareerTotals>();
  for (const c of career) {
    totals.set(c.player_id, {
      games: c.games, goals: c.goals, assists: c.assists, saves: c.saves,
      shots: c.shots, score: c.score, demos: c.demos, demoed: c.demoed,
    });
  }

  if (seeded.length) {
    const playerIds = await resolvePlayerIds([...new Set(seeded.map((s) => s.discord_id))]);
    for (const s of seeded) {
      const playerId = playerIds.get(s.discord_id);
      if (!playerId) continue;
      let t = totals.get(playerId);
      if (!t) totals.set(playerId, (t = { ...ZERO }));
      t.games += s.games;
      t.goals += s.goals;
      t.assists += s.assists;
      t.saves += s.saves;
      t.shots += s.shots;
      t.score += s.score;
      t.demos += s.demos;
      t.demoed += s.demoed;
    }
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
    .not("player_id", "is", null)
    .limit(1);
  if ((count ?? 0) > 0) return true;

  // A seeded row only counts once its player has joined. Counting the rows
  // themselves would show the Stats tab from the moment a past season was
  // seeded, over a table that filters every one of those rows out.
  const seeded = await fetchSeededRows();
  if (!seeded.length) return false;
  const resolved = await resolvePlayerIds([...new Set(seeded.map((s) => s.discord_id))]);
  return resolved.size > 0;
}
