import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
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
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Live Draft</h1>
        <p className="text-zinc-400 text-sm">No draft is currently active.</p>
      </div>
    );
  }

  const numTeams: number = settings.num_teams ?? 0;
  const currentPick: number = settings.current_pick ?? 0;
  const totalPicks = numTeams * 2;
  const phase: "nomination" | "bidding" = settings.draft_phase ?? "nomination";

  // Teams with credits
  const { data: teamsRaw } = await supabaseAdmin
    .from("teams").select("id, name, credits").ilike("name", "Team %").order("name");
  const teams = (teamsRaw ?? []).filter(t => /^Team \d+$/.test(t.name));

  // Roster sizes
  const { data: drafted } = await supabaseAdmin
    .from("players").select("team_id").eq("status", "approved").not("team_id", "is", null);
  const rosterSizeById: Record<string, number> = {};
  drafted?.forEach(p => { if (p.team_id) rosterSizeById[p.team_id] = (rosterSizeById[p.team_id] ?? 0) + 1; });

  // Available players — exclude whoever is currently being bid on
  const { data: available } = await supabaseAdmin
    .from("players")
    .select("id, username, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("status", "approved").eq("draft_entered", true).is("team_id", null);
  const availableSorted = [...(available ?? [])]
    .filter(p => p.id !== settings.nominated_player_id)
    .sort((a, b) => rankValue(b) - rankValue(a));

  // Nominated player
  let nominatedPlayerName: string | null = null;
  let nominatedPlayerRv: number | null = null;
  if (settings.nominated_player_id) {
    const { data: np } = await supabaseAdmin
      .from("players").select("username, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .eq("id", settings.nominated_player_id).single();
    if (np) { nominatedPlayerName = np.username; nominatedPlayerRv = Math.round(rankValue(np)); }
  }

  // Leading team name
  let leadingTeamName: string | null = null;
  if (settings.current_bid_team_id) {
    const match = teams.find(t => t.id === settings.current_bid_team_id);
    leadingTeamName = match?.name ?? null;
  }

  // Nomination queue (next 6 turns)
  const queueSize = Math.min(6, totalPicks - currentPick);
  const nominationQueue = Array.from({ length: queueSize }, (_, i) => ({
    pick: currentPick + i,
    teamNum: getTeamNumberForPick(currentPick + i, numTeams),
    isCurrent: i === 0,
  }));

  // Viewer's team (for highlighting)
  const callerId = session?.userId ?? "";
  let viewerTeamId: string | null = null;
  if (callerId) {
    const { data: vp } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", callerId).single();
    viewerTeamId = vp?.team_id ?? null;
  }

  return (
    <DraftLive
      phase={phase}
      numTeams={numTeams}
      currentPick={currentPick}
      totalPicks={totalPicks}
      nominatedPlayerName={nominatedPlayerName}
      nominatedPlayerRv={nominatedPlayerRv}
      currentBid={settings.current_bid as number | null}
      leadingTeamName={leadingTeamName}
      pickDeadline={settings.pick_deadline as string | null}
      teams={teams.map(t => ({
        id: t.id,
        name: t.name,
        credits: (t.credits ?? 1000) as number,
        rosterSize: rosterSizeById[t.id] ?? 0,
        isLeading: t.id === settings.current_bid_team_id,
        isOnClock: t.name === `Team ${getTeamNumberForPick(currentPick, numTeams)}` && phase === "nomination",
      }))}
      availablePlayers={availableSorted.map(p => ({
        id: p.id,
        username: p.username,
        rv: Math.round(rankValue(p)),
      }))}
      nominationQueue={nominationQueue}
      viewerTeamId={viewerTeamId}
      userIsAdmin={isAdmin(callerId)}
    />
  );
}
