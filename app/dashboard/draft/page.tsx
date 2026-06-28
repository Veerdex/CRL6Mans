import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { DraftLive } from "./draft-live";

function getTeamNumberForPick(pickIndex: number, numTeams: number): number {
  const pickInRound = pickIndex % numTeams;
  const roundIndex = Math.floor(pickIndex / numTeams);
  return roundIndex % 2 === 0 ? numTeams - pickInRound : pickInRound + 1;
}

function rankValue(p: { peak_2v2: string | number; current_2v2: string | number; peak_3v3: string | number; current_3v3: string | number }) {
  return ((Number(p.peak_2v2) + Number(p.current_2v2)) * 1.2 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.8) / 4;
}

export default async function DraftPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();

  if (!settings?.draft_active) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Live Draft</h1>
        <p className="text-zinc-400 text-sm">No draft is currently active.</p>
      </div>
    );
  }

  const numTeams: number = settings.num_teams ?? 0;
  const currentPick: number = settings.current_pick ?? 0;
  const totalPicks = numTeams * 2;

  // Teams with roster sizes
  const { data: teamsRaw } = await supabaseAdmin
    .from("teams").select("id, name").ilike("name", "Team %").order("name");
  const teams = (teamsRaw ?? [])
    .filter(t => /^Team \d+$/.test(t.name))
    .filter(t => parseInt(t.name.replace("Team ", "")) <= numTeams);

  const { data: drafted } = await supabaseAdmin
    .from("players").select("team_id").eq("status", "approved").not("team_id", "is", null);
  const rosterSizeById: Record<string, number> = {};
  drafted?.forEach(p => { if (p.team_id) rosterSizeById[p.team_id] = (rosterSizeById[p.team_id] ?? 0) + 1; });

  // Available players
  const { data: available } = await supabaseAdmin
    .from("players")
    .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("status", "approved").eq("in_active_draft", true).is("team_id", null);
  const availableSorted = [...(available ?? [])].sort((a, b) => rankValue(b) - rankValue(a));

  // Pick queue (next 6 turns)
  const queueSize = Math.min(6, totalPicks - currentPick);
  const pickQueue = Array.from({ length: queueSize }, (_, i) => ({
    pick: currentPick + i,
    teamNum: getTeamNumberForPick(currentPick + i, numTeams),
    isCurrent: i === 0,
  }));

  // Viewer's team
  const callerId = session?.userId ?? "";
  let viewerTeamId: string | null = null;
  if (callerId) {
    const { data: vp } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", callerId).single();
    viewerTeamId = vp?.team_id ?? null;
  }

  return (
    <DraftLive
      numTeams={numTeams}
      currentPick={currentPick}
      totalPicks={totalPicks}
      pickDeadline={settings.pick_deadline as string | null}
      teams={teams.map(t => ({
        id: t.id,
        name: t.name,
        rosterSize: rosterSizeById[t.id] ?? 0,
        isOnClock: t.name === `Team ${getTeamNumberForPick(currentPick, numTeams)}`,
      }))}
      availablePlayers={availableSorted.map(p => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name ?? null,
        rv: Math.round(rankValue(p)),
      }))}
      pickQueue={pickQueue}
      viewerTeamId={viewerTeamId}
      userIsAdmin={await isModerator(callerId)}
    />
  );
}
