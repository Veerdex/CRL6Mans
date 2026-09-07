import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchAllRows } from "@/app/lib/paginate";
import { fetchAllTimeTotals } from "@/app/lib/career-stats";
import { aggregatePlayerGameStats, type StatAggregationInput } from "@/app/lib/player-stat-aggregation";
import type { PlayerStatRow } from "./stats-table";
import { StatsView } from "./stats-view";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

type PlayerRow = { id: string; discord_id: string | null; username: string; display_name: string | null; team_id: string | null };

// "Current Event" only means something while one is running. Between events
// player_game_stats is empty — rollUpCareerStats folds it into the career table
// on reset — so offering the toggle would offer an empty table. stats_enabled is
// the separate case of an event that runs without replay tracking at all.
async function showEventToggle(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("season_active, active_tournament_id, stats_enabled")
    .single();
  const eventRunning = !!data?.season_active || !!data?.active_tournament_id;
  return eventRunning && (data?.stats_enabled ?? true);
}

export default async function StatsPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const [statsRaw, playersRaw, teamsRaw, allTimeTotals, showToggle] = await Promise.all([
    fetchAllRows<{
      player_id: string; goals: number; assists: number; saves: number; shots: number;
      score: number; demos: number; demoed: number;
    }>((from, to) =>
      supabaseAdmin
        .from("player_game_stats")
        .select("player_id, goals, assists, saves, shots, score, demos, demoed")
        .not("player_id", "is", null)
        .order("match_id")
        .order("game_number")
        .range(from, to)
    ),
    fetchAllRows<PlayerRow>((from, to) =>
      supabaseAdmin
        .from("players")
        .select("id, discord_id, username, display_name, team_id")
        .eq("status", "approved")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<{ id: string; name: string }>((from, to) =>
      supabaseAdmin.from("teams").select("id, name").order("id").range(from, to)
    ),
    fetchAllTimeTotals(),
    showEventToggle(),
  ]);

  const teamNames = Object.fromEntries(teamsRaw.map((t) => [t.id, t.name]));
  const playerMap = Object.fromEntries(playersRaw.map((p) => [p.id, p]));
  const teamNameOf = (p: PlayerRow) => (p.team_id ? (teamNames[p.team_id] ?? null) : null);

  const inputs: StatAggregationInput[] = statsRaw
    .filter((r) => playerMap[r.player_id])
    .map((r) => {
      const player = playerMap[r.player_id];
      return {
        key: r.player_id,
        discordId: player.discord_id,
        username: player.username,
        displayName: player.display_name,
        teamName: teamNameOf(player),
        goals: r.goals, assists: r.assists, saves: r.saves, shots: r.shots, score: r.score,
        demos: r.demos, demoed: r.demoed,
      };
    });
  const currentRows = aggregatePlayerGameStats(inputs);

  // Built directly rather than through aggregatePlayerGameStats — that helper
  // counts one game per input row, which pre-summed career totals aren't.
  const allTimeRows: PlayerStatRow[] = [...allTimeTotals.entries()]
    .filter(([playerId]) => playerMap[playerId])
    .map(([playerId, t]) => {
      const player = playerMap[playerId];
      return {
        playerId,
        discordId: player.discord_id,
        username: player.username,
        displayName: player.display_name,
        teamName: teamNameOf(player),
        games: t.games,
        totalGoals: t.goals,
        totalAssists: t.assists,
        totalSaves: t.saves,
        totalShots: t.shots,
        totalScore: t.score,
        totalDemos: t.demos,
        totalDemoed: t.demoed,
      };
    });

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="text-2xl font-bold text-white">Stats</h1>
        <SponsoredByLine tabKey="stats" />
      </div>
      {/* Nothing to switch to with no event in progress — the page falls back
          to all-time only. */}
      <StatsView currentRows={currentRows} allTimeRows={allTimeRows} showToggle={showToggle} />
      <p className="mt-3 text-xs text-zinc-700">
        MVP = ((G+A+Sv+Sh÷10)÷(GP×4)) + Sc÷1000
      </p>
    </div>
  );
}
