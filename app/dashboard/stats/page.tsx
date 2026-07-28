import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { aggregatePlayerGameStats, type StatAggregationInput } from "@/app/lib/player-stat-aggregation";
import { StatsTable } from "./stats-table";

export default async function StatsPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

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

  const inputs: StatAggregationInput[] = (statsRaw ?? [])
    .filter((r) => r.player_id && playerMap[r.player_id])
    .map((r) => {
      const player = playerMap[r.player_id];
      return {
        key: r.player_id,
        username: player.username,
        displayName: (player as typeof player & { display_name?: string | null }).display_name ?? null,
        teamName: player.team_id ? (teamNames[player.team_id] ?? null) : null,
        goals: r.goals, assists: r.assists, saves: r.saves, shots: r.shots, score: r.score,
      };
    });
  const rows = aggregatePlayerGameStats(inputs);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-white mb-1">Stats</h1>
      <p className="text-zinc-500 text-sm mb-6">
        Per-player performance from uploaded game replays. Click any column header to sort.
      </p>
      <StatsTable rows={rows} />
      <p className="mt-3 text-xs text-zinc-700">
        MVP = ((G+A+Sv+Sh÷10)÷(GP×4)) + Sc÷1000
      </p>
    </div>
  );
}
