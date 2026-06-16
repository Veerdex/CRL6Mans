import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { getPlayerInfo } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { StatsTable, type PlayerStatRow } from "./stats-table";

export default async function StatsPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { status } = await getPlayerInfo(session.userId);
  if (status !== "approved") redirect("/dashboard");

  const [{ data: statsRaw }, { data: playersRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("player_game_stats")
      .select("player_id, goals, assists, saves, shots, score")
      .not("player_id", "is", null),
    supabaseAdmin.from("players").select("id, username, display_name, team_id").eq("status", "approved"),
    supabaseAdmin.from("teams").select("id, name"),
  ]);

  const teamNames = Object.fromEntries((teamsRaw ?? []).map((t) => [t.id, t.name]));
  const playerMap = Object.fromEntries((playersRaw ?? []).map((p) => [p.id, p]));

  type Agg = { totalGoals: number; totalAssists: number; totalSaves: number; totalShots: number; totalScore: number; games: number };
  const aggMap = new Map<string, Agg>();

  for (const r of (statsRaw ?? []) as { player_id: string; goals: number; assists: number; saves: number; shots: number; score: number }[]) {
    if (!r.player_id) continue;
    const prev = aggMap.get(r.player_id) ?? { totalGoals: 0, totalAssists: 0, totalSaves: 0, totalShots: 0, totalScore: 0, games: 0 };
    aggMap.set(r.player_id, {
      totalGoals:   prev.totalGoals   + r.goals,
      totalAssists: prev.totalAssists + r.assists,
      totalSaves:   prev.totalSaves   + r.saves,
      totalShots:   prev.totalShots   + r.shots,
      totalScore:   prev.totalScore   + r.score,
      games:        prev.games        + 1,
    });
  }

  const rows: PlayerStatRow[] = [];
  for (const [playerId, agg] of aggMap) {
    const player = playerMap[playerId];
    if (!player) continue;
    rows.push({
      playerId,
      username:     player.username,
      displayName:  (player as typeof player & { display_name?: string | null }).display_name ?? null,
      teamName:     player.team_id ? (teamNames[player.team_id] ?? null) : null,
      games:        agg.games,
      totalGoals:   agg.totalGoals,
      totalAssists: agg.totalAssists,
      totalSaves:   agg.totalSaves,
      totalShots:   agg.totalShots,
      totalScore:   agg.totalScore,
    });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-white mb-1">Stats</h1>
      <p className="text-zinc-500 text-sm mb-6">
        Per-player performance from uploaded game replays. Click any column header to sort.
      </p>
      <StatsTable rows={rows} />
      <p className="mt-3 text-xs text-zinc-700">
        Demos not tracked — not stored in replay headers.
        MVP = ((G+A+Sv+Sh÷10)÷(GP×4)) + Sc÷1000
      </p>
    </div>
  );
}
