import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isCurrentlyKicked } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import type { TopStats } from "@/app/lib/game-stats";
import { PodiumClient, type RichPlayer, type Accolade } from "./podium-client";

type SnapshotPlayer = { username: string; displayName: string | null };
type Summary = {
  champion: string | null;
  championLogoUrl?: string | null;
  championPlayers?: SnapshotPlayer[];
  topStats?: TopStats;
};

export default async function PodiumPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

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

  const mvpUsername = summary.topStats?.mvpUsername ?? null;
  const rosterUsernames = summary.championPlayers?.map((p) => p.username) ?? [];
  const lookupUsernames = mvpUsername && !rosterUsernames.includes(mvpUsername)
    ? [...rosterUsernames, mvpUsername]
    : rosterUsernames;

  if (lookupUsernames.length) {
    const { data: rows } = await supabaseAdmin
      .from("players")
      .select("id, username, display_name, discord_id, avatar, status, kick_reason, kicked_until")
      .in("username", lookupUsernames);

    const byUsername = Object.fromEntries((rows ?? []).map((r) => [r.username, r]));

    if (summary.championPlayers?.length) {
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

    mvpPlayerId = mvpUsername ? byUsername[mvpUsername]?.id ?? null : null;
  }

  // Stat leaders for this specific season/tournament, snapshotted at completion time
  const accolades: Accolade[] = summary.topStats?.accolades ?? [];

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
