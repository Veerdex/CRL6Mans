import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { calculatePlayerRating } from "@/app/lib/rating";
import { AdminTeamsManager } from "./admin-teams-manager";
import { TeamsGrid } from "./teams-grid";
import { BackButton } from "./back-button";

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; from?: string }>;
}) {
  const { search: initialSearch, from } = await searchParams;
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  const userIsAdmin = session?.userId ? await isModeratorVerified(session.userId) : false;

  const [{ data: teamsRaw }, { data: allPlayers }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name, logo_url, logo_offset_x, logo_offset_y, is_locked, is_disqualified, disqualified_at"),
    supabaseAdmin
      .from("players")
      .select("id, username, display_name, discord_id, avatar, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1, tracker_url, is_captain, team_id")
      .eq("status", "approved")
      .not("team_id", "is", null),
    supabaseAdmin.from("league_settings").select("active_tournament_id, season_active").single(),
  ]);

  const activeTournamentId = (settings?.active_tournament_id as string | null) ?? null;

  let joinMode: "players" | "teams" = "players";
  if (activeTournamentId) {
    const { data: tourney } = await supabaseAdmin
      .from("tournaments").select("join_mode").eq("id", activeTournamentId).single();
    joinMode = (tourney?.join_mode as "players" | "teams" | undefined) ?? "players";
  }

  // Fetch tournament entries once — used for both allowedTeamIds and availablePlayers.
  let entryPlayerIds: Set<string> | null = null;
  if (activeTournamentId) {
    const { data: entries } = await supabaseAdmin
      .from("tournament_entries")
      .select("player_id")
      .eq("tournament_id", activeTournamentId);
    entryPlayerIds = new Set((entries ?? []).map((e: { player_id: string }) => e.player_id));
  }

  // When there's an active tournament, restrict to only the teams whose players entered it.
  let allowedTeamIds: Set<string> | null = null;
  if (entryPlayerIds) {
    allowedTeamIds = new Set(
      (allPlayers ?? [])
        .filter((p) => p.id && entryPlayerIds!.has(p.id) && p.team_id)
        .map((p) => p.team_id as string)
    );
  }

  // All approved players not currently on a team — passed to AdminTeamsManager as the
  // bench swap pool, regardless of whether they entered the active tournament/draft.
  type AvailablePlayer = { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string; peak_1v1: string | null; current_1v1: string | null; team_id: string | null };
  let availablePlayers: AvailablePlayer[] = [];
  if (userIsAdmin) {
    const { data: participants } = await supabaseAdmin
      .from("players")
      .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1, team_id")
      .eq("status", "approved")
      .is("team_id", null);
    availablePlayers = (participants ?? []) as AvailablePlayer[];
  }

  // Group players by team
  const byTeam: Record<string, NonNullable<typeof allPlayers>> = {};
  (teamsRaw ?? []).forEach((t) => { byTeam[t.id] = []; });
  allPlayers?.forEach((p) => {
    if (p.team_id && byTeam[p.team_id]) byTeam[p.team_id].push(p);
  });

  // Filter teams:
  // - Active tournament: only teams whose players entered that tournament
  // - Otherwise: all teams that have at least one player assigned (browsable any time)
  const teams = (teamsRaw ?? []).filter((t) => {
    if (allowedTeamIds) return allowedTeamIds.has(t.id);
    return byTeam[t.id].length > 0;
  });

  const ratingOf = (p: { peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string; peak_1v1: string | null; current_1v1: string | null }) =>
    calculatePlayerRating({
      at_1v1: Number(p.peak_1v1 ?? 0), season_1v1: Number(p.current_1v1 ?? 0),
      at_2v2: Number(p.peak_2v2 ?? 0), season_2v2: Number(p.current_2v2 ?? 0),
      at_3v3: Number(p.peak_3v3 ?? 0), season_3v3: Number(p.current_3v3 ?? 0),
    });

  // Sort rosters: captain first, then by rating
  Object.values(byTeam).forEach((roster) => {
    roster?.sort((a, b) => {
      if (a.is_captain !== b.is_captain) return a.is_captain ? -1 : 1;
      return ratingOf(b) - ratingOf(a);
    });
  });

  // Sort teams by average rating
  const teamAvgMmr = (teamId: string): number => {
    const roster = byTeam[teamId] ?? [];
    if (!roster.length) return 0;
    const total = roster.reduce((sum, p) => sum + ratingOf(p), 0);
    return total / roster.length;
  };
  teams.sort((a, b) => teamAvgMmr(b.id) - teamAvgMmr(a.id));

  // Find the current user's team (for highlighting)
  const myPlayer = session?.userId
    ? allPlayers?.find((p) => p.discord_id === session.userId) ?? null
    : null;
  const myTeamId = myPlayer?.team_id ?? null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-10">
      {from === "season" && <BackButton label="Back to Season" />}
      {/* All Teams */}
      <section>
        <h1 className="text-xl font-bold text-white mb-4">Teams</h1>
        {teams.length === 0 ? (
          <p className="text-zinc-400">No teams yet — the draft hasn&apos;t started.</p>
        ) : userIsAdmin ? (
          <AdminTeamsManager
            teams={teams}
            byTeam={byTeam as Record<string, {
              id: string; username: string; display_name: string | null; discord_id: string | null; avatar: string | null;
              peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
              peak_1v1: string | null; current_1v1: string | null; tracker_url: string;
              is_captain: boolean | null; team_id: string | null;
            }[]>}
            avgMmr={Object.fromEntries(teams.map(t => [t.id, Math.round(teamAvgMmr(t.id))]))}
            availablePlayers={availablePlayers}
            initialQuery={initialSearch ?? ""}
            joinMode={joinMode}
          />
        ) : (
          <TeamsGrid
            teams={teams}
            byTeam={byTeam as Record<string, {
              id: string; username: string; display_name: string | null; discord_id: string | null; avatar: string | null;
              peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
              peak_1v1: string | null; current_1v1: string | null; tracker_url: string;
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

