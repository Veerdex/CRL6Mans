import { supabaseAdmin } from "@/app/lib/supabase";
import { isCurrentlyKicked } from "@/app/lib/players";

export type TopStatAccolade = { label: string; playerName: string; value: string; isMvp: boolean };
export type TopStats = { accolades: TopStatAccolade[]; mvpUsername: string | null };

type Agg = {
  username: string;
  games: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
};

function mvpScore(a: Agg): number {
  if (a.games === 0) return 0;
  return (a.goals + a.assists + a.saves + a.shots / 10) / (a.games * 4) + a.score / a.games / 1000;
}

/**
 * Stat leaders from every player_game_stats row currently live. Must be called
 * before resetSeason() deletes matches — player_game_stats.match_id cascades on
 * delete, so this data is unrecoverable once a season/tournament wipe runs.
 * Since only one season/tournament is ever live at a time, every row present
 * here belongs to the event that's completing.
 */
export async function computeTopStats(): Promise<TopStats> {
  const [{ data: statsRaw }, { data: players }] = await Promise.all([
    supabaseAdmin
      .from("player_game_stats")
      .select("player_id, goals, assists, saves, shots, score")
      .not("player_id", "is", null),
    supabaseAdmin.from("players").select("id, username, display_name, status, kick_reason, kicked_until").eq("status", "approved"),
  ]);

  const eligible = (players ?? []).filter((p) => !isCurrentlyKicked(p.kick_reason, p.kicked_until));
  const nameById = Object.fromEntries(eligible.map((p) => [p.id, p.display_name ?? p.username]));
  const usernameById = Object.fromEntries(eligible.map((p) => [p.id, p.username]));

  const agg = new Map<string, Agg>();
  for (const r of (statsRaw ?? []) as {
    player_id: string; goals: number; assists: number; saves: number; shots: number; score: number;
  }[]) {
    if (!r.player_id || !nameById[r.player_id]) continue;
    const prev = agg.get(r.player_id) ?? { username: nameById[r.player_id], games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0 };
    agg.set(r.player_id, {
      username: prev.username,
      games: prev.games + 1,
      goals: prev.goals + (r.goals ?? 0),
      assists: prev.assists + (r.assists ?? 0),
      saves: prev.saves + (r.saves ?? 0),
      shots: prev.shots + (r.shots ?? 0),
      score: prev.score + (r.score ?? 0),
    });
  }

  const entries = [...agg.entries()];
  const leader = (valueFn: (a: Agg) => number) => {
    let bestId: string | null = null;
    let bestVal = -Infinity;
    for (const [id, a] of entries) {
      const v = valueFn(a);
      if (v > bestVal) { bestVal = v; bestId = id; }
    }
    return bestId ? { id: bestId, agg: agg.get(bestId)!, value: bestVal } : null;
  };

  if (entries.length === 0) return { accolades: [], mvpUsername: null };

  const mvp = leader(mvpScore);
  const points = leader((a) => (a.games > 0 ? a.score / a.games : 0));
  const goals = leader((a) => (a.games > 0 ? a.goals / a.games : 0));
  const assists = leader((a) => (a.games > 0 ? a.assists / a.games : 0));

  const accolades: TopStatAccolade[] = [];
  let mvpUsername: string | null = null;

  if (mvp) {
    mvpUsername = usernameById[mvp.id] ?? null;
    accolades.push({ label: "MVP", playerName: mvp.agg.username, value: mvp.value.toFixed(3), isMvp: true });
  }
  if (points) accolades.push({ label: "Points Per Game", playerName: points.agg.username, value: Math.round(points.value).toString(), isMvp: false });
  if (goals) accolades.push({ label: "Goals Per Game", playerName: goals.agg.username, value: goals.value.toFixed(2), isMvp: false });
  if (assists) accolades.push({ label: "Assists Per Game", playerName: assists.agg.username, value: assists.value.toFixed(2), isMvp: false });

  return { accolades, mvpUsername };
}
