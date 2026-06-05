import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { type Player, getPlayerInfo } from "@/app/lib/players";
import PlayersList from "./players-list";

export default async function PlayersPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { status } = await getPlayerInfo(session.userId);
  if (status !== "approved") redirect("/dashboard");

  const [{ data: playersRaw }, { data: teams }] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select(
        "id, discord_id, username, avatar, peak_3v3, current_3v3, peak_2v2, current_2v2, tracker_url, team_id, created_at, status, draft_entered"
      )
      .eq("status", "approved")
      .eq("draft_entered", true),
    supabaseAdmin.from("teams").select("id, name"),
  ]);

  const players = ((playersRaw ?? []) as Player[]).sort((a, b) => {
    const aMax = Math.max(Number(a.peak_2v2) || 0, Number(a.peak_3v3) || 0);
    const bMax = Math.max(Number(b.peak_2v2) || 0, Number(b.peak_3v3) || 0);
    return bMax - aMax;
  });

  const teamNames: Record<string, string> = {};
  teams?.forEach((t) => { teamNames[t.id] = t.name; });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Players</h1>
      {players.length === 0 ? (
        <p className="text-zinc-500 text-sm">No players have entered the draft pool yet.</p>
      ) : (
        <PlayersList players={players} teamNames={teamNames} />
      )}
    </div>
  );
}
