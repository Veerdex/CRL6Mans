import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { getPlayerInfo, isCurrentlyKicked } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { PodiumClient, type RichPlayer, type Accolade } from "./podium-client";

type SnapshotPlayer = { username: string; displayName: string | null };
type Summary = {
  champion: string | null;
  championLogoUrl?: string | null;
  championPlayers?: SnapshotPlayer[];
};

type Agg = {
  name: string;
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

export default async function PodiumPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");
  const { status } = await getPlayerInfo(session.userId);
  if (status !== "approved") redirect("/dashboard");

  const [{ data: recentSeasons }, { data: recentTournaments }] = await Promise.all([
    supabaseAdmin
      .from("seasons")
      .select("name, summary, ended_at")
      .eq("hidden_from_home", false)
      .order("ended_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("tournaments")
      .select("name, summary, ended_at")
      .eq("status", "completed")
      .eq("hidden_from_home", false)
      .order("ended_at", { ascending: false })
      .limit(10),
  ]);

  // Skip events with no champion (e.g. test runs completed without any matches played)
  const hasChampion = (s: { summary: unknown }) => !!(s.summary as Summary | null)?.champion;
  const latestSeason = (recentSeasons ?? []).find(hasChampion) ?? null;
  const latestTournament = (recentTournaments ?? []).find(hasChampion) ?? null;

  const seasonDate = latestSeason?.ended_at ? new Date(latestSeason.ended_at).getTime() : 0;
  const tourneyDate = latestTournament?.ended_at ? new Date(latestTournament.ended_at).getTime() : 0;

  let eventTitle = "";
  let eventKind: "season" | "tournament" = "tournament";
  let eventDate: string | null = null;
  let summary: Summary = { champion: null };

  if (latestSeason && seasonDate >= tourneyDate) {
    eventTitle = latestSeason.name;
    eventKind = "season";
    eventDate = latestSeason.ended_at;
    summary = latestSeason.summary as Summary;
  } else if (latestTournament) {
    eventTitle = latestTournament.name;
    eventKind = "tournament";
    eventDate = latestTournament.ended_at;
    summary = latestTournament.summary as Summary;
  }

  // Nothing to celebrate yet — don't show an empty podium; the nav link is hidden too.
  if (!eventTitle || !summary.champion) {
    redirect("/dashboard");
  }

  // Champion roster — avatars below the logo
  let players: RichPlayer[] = [];
  let mvpPlayerId: string | null = null;

  if (summary.championPlayers?.length) {
    const usernames = summary.championPlayers.map((p) => p.username);
    const { data: rows } = await supabaseAdmin
      .from("players")
      .select("id, username, display_name, discord_id, avatar, status, kick_reason, kicked_until")
      .in("username", usernames);

    const byUsername = Object.fromEntries((rows ?? []).map((r) => [r.username, r]));
    players = summary.championPlayers
      .filter((p) => {
        const row = byUsername[p.username];
        return !(row && (row.status === "banned" || isCurrentlyKicked(row.kick_reason, row.kicked_until)));
      })
      .map((p) => {
        const row = byUsername[p.username];
        return {
          id: row?.id ?? null,
          username: p.username,
          displayName: p.displayName ?? row?.display_name ?? null,
          discordId: row?.discord_id ?? null,
          avatar: row?.avatar ?? null,
        };
      });
  }

  // League-wide accolades — leaders across all players with recorded stats
  const [{ data: statsRaw }, { data: allPlayers }] = await Promise.all([
    supabaseAdmin
      .from("player_game_stats")
      .select("player_id, goals, assists, saves, shots, score")
      .not("player_id", "is", null),
    supabaseAdmin.from("players").select("id, username, display_name, kick_reason, kicked_until").eq("status", "approved"),
  ]);

  const nameById = Object.fromEntries(
    (allPlayers ?? [])
      .filter((p) => !isCurrentlyKicked(p.kick_reason, p.kicked_until))
      .map((p) => [p.id, p.display_name ?? p.username])
  );

  const agg = new Map<string, Agg>();
  for (const r of (statsRaw ?? []) as {
    player_id: string; goals: number; assists: number; saves: number; shots: number; score: number;
  }[]) {
    if (!r.player_id || !nameById[r.player_id]) continue;
    const prev = agg.get(r.player_id) ?? { name: nameById[r.player_id], games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0 };
    agg.set(r.player_id, {
      name: prev.name,
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

  const accolades: Accolade[] = [];
  if (entries.length > 0) {
    const mvp = leader(mvpScore);
    const points = leader((a) => (a.games > 0 ? a.score / a.games : 0));
    const goals = leader((a) => (a.games > 0 ? a.goals / a.games : 0));
    const assists = leader((a) => (a.games > 0 ? a.assists / a.games : 0));

    if (mvp) {
      mvpPlayerId = mvp.id;
      accolades.push({ label: "MVP", playerName: mvp.agg.name, value: mvp.value.toFixed(3), isMvp: true });
    }
    if (points) accolades.push({ label: "Points Per Game", playerName: points.agg.name, value: Math.round(points.value).toString(), isMvp: false });
    if (goals) accolades.push({ label: "Goals Per Game", playerName: goals.agg.name, value: goals.value.toFixed(2), isMvp: false });
    if (assists) accolades.push({ label: "Assists Per Game", playerName: assists.agg.name, value: assists.value.toFixed(2), isMvp: false });
  }

  return (
    <PodiumClient
      eventTitle={eventTitle}
      eventKind={eventKind}
      eventDate={eventDate}
      champion={summary.champion}
      championLogoUrl={summary.championLogoUrl ?? null}
      players={players}
      mvpPlayerId={mvpPlayerId}
      accolades={accolades}
    />
  );
}
