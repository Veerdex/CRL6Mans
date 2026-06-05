import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { AdminTeamsManager } from "./admin-teams-manager";
import { TeamsGrid } from "./teams-grid";

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search: initialSearch } = await searchParams;
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  const userIsAdmin = session?.userId ? isAdmin(session.userId) : false;

  const [{ data: teamsRaw }, { data: allPlayers }] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name, logo_url, logo_offset_x, logo_offset_y, is_locked"),
    supabaseAdmin
      .from("players")
      .select("id, username, discord_id, avatar, peak_2v2, peak_3v3, tracker_url, is_captain, team_id")
      .eq("status", "approved")
      .not("team_id", "is", null),
  ]);

  const teams = [...(teamsRaw ?? [])];

  // Group players by team
  const byTeam: Record<string, typeof allPlayers> = {};
  teams.forEach((t) => { byTeam[t.id] = []; });
  allPlayers?.forEach((p) => {
    if (p.team_id && byTeam[p.team_id]) byTeam[p.team_id].push(p);
  });

  // Sort rosters: captain first, then by peak MMR
  Object.values(byTeam).forEach((roster) => {
    roster?.sort((a, b) => {
      if (a.is_captain !== b.is_captain) return a.is_captain ? -1 : 1;
      const peakA = Math.max(Number(a.peak_2v2) || 0, Number(a.peak_3v3) || 0);
      const peakB = Math.max(Number(b.peak_2v2) || 0, Number(b.peak_3v3) || 0);
      return peakB - peakA;
    });
  });

  // Sort teams by average peak MMR (highest between each player's peak_2v2 and peak_3v3)
  const teamAvgMmr = (teamId: string): number => {
    const roster = byTeam[teamId] ?? [];
    if (!roster.length) return 0;
    const total = roster.reduce((sum, p) => sum + Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0), 0);
    return total / roster.length;
  };
  teams.sort((a, b) => teamAvgMmr(b.id) - teamAvgMmr(a.id));

  // Find the current user's team (for highlighting)
  const myPlayer = session?.userId
    ? allPlayers?.find((p) => p.discord_id === session.userId) ?? null
    : null;
  const myTeamId = myPlayer?.team_id ?? null;

  return (
    <div className="p-8 space-y-10">
      {/* All Teams */}
      <section>
        <h1 className="text-xl font-bold text-white mb-4">Teams</h1>
        {teams.length === 0 ? (
          <p className="text-zinc-400">No teams yet — the draft hasn&apos;t started.</p>
        ) : userIsAdmin ? (
          <AdminTeamsManager
            teams={teams}
            byTeam={byTeam as Record<string, {
              id: string; username: string; discord_id: string | null; avatar: string | null;
              peak_2v2: string; peak_3v3: string; tracker_url: string;
              is_captain: boolean | null; team_id: string | null;
            }[]>}
            avgMmr={Object.fromEntries(teams.map(t => [t.id, Math.round(teamAvgMmr(t.id))]))}
            initialQuery={initialSearch ?? ""}
          />
        ) : (
          <TeamsGrid
            teams={teams}
            byTeam={byTeam as Record<string, {
              id: string; username: string; discord_id: string | null; avatar: string | null;
              peak_2v2: string; peak_3v3: string; tracker_url: string;
              is_captain: boolean | null; team_id: string | null;
            }[]>}
            avgMmr={Object.fromEntries(teams.map((t) => [t.id, Math.round(teamAvgMmr(t.id))]))}
            myTeamId={myTeamId}
            initialQuery={initialSearch ?? ""}
          />
        )}
      </section>
    </div>
  );
}

