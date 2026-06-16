import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { type Player, getPlayerInfo } from "@/app/lib/players";
import PlayersList from "./players-list";
import type { StatAgg } from "./player-stats-modal";

export default async function PlayersPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { status } = await getPlayerInfo(session.userId);
  if (status !== "approved") redirect("/dashboard");

  const [{ data: playersRaw }, { data: teams }, { data: statsRaw }] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select(
        "id, discord_id, username, display_name, avatar, peak_3v3, current_3v3, peak_2v2, current_2v2, tracker_url, team_id, created_at, status, draft_entered"
      )
      .eq("status", "approved")
      .eq("draft_entered", true),
    supabaseAdmin.from("teams").select("id, name"),
    supabaseAdmin
      .from("player_game_stats")
      .select("player_id, goals, assists, saves, shots, score")
      .not("player_id", "is", null),
  ]);

  // Aggregate per-player scoreboard stats from the current event's replays.
  const statsByPlayer: Record<string, StatAgg> = {};
  for (const r of (statsRaw ?? []) as { player_id: string; goals: number; assists: number; saves: number; shots: number; score: number }[]) {
    if (!r.player_id) continue;
    const a = (statsByPlayer[r.player_id] ??= { games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0 });
    a.games++; a.goals += r.goals; a.assists += r.assists; a.saves += r.saves; a.shots += r.shots; a.score += r.score;
  }

  const players = ((playersRaw ?? []) as Player[]).sort((a, b) => {
    const aRv = (Number(a.peak_2v2) + Number(a.current_2v2)) * 0.3 + (Number(a.peak_3v3) + Number(a.current_3v3)) * 0.2;
    const bRv = (Number(b.peak_2v2) + Number(b.current_2v2)) * 0.3 + (Number(b.peak_3v3) + Number(b.current_3v3)) * 0.2;
    return bRv - aRv;
  });

  const teamNames: Record<string, string> = {};
  teams?.forEach((t) => { teamNames[t.id] = t.name; });

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Players</h1>
      {players.length === 0 ? (
        <p className="text-zinc-500 text-sm">No players have entered the draft pool yet.</p>
      ) : (
        <PlayersList players={players} teamNames={teamNames} statsByPlayer={statsByPlayer} />
      )}
    </div>
  );
}
