import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isCurrentlyKicked } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import type { TopStats } from "@/app/lib/game-stats";
import { PodiumClient, type RichPlayer, type Accolade } from "./podium-client";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

type SnapshotPlayer = { id?: string | null; username: string; displayName: string | null };
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

  // Accolades are a tournament-only feature. Seasons still snapshot topStats at
  // completion — the stats cascade away with their matches on a wipe, so leaving
  // the snapshot in place is what keeps this reversible.
  const isTournament = eventKind === "tournament";

  const mvpUsername = isTournament ? summary.topStats?.mvpUsername ?? null : null;
  const snapshotMvpId = isTournament ? summary.topStats?.mvpPlayerId ?? null : null;
  const roster = summary.championPlayers ?? [];

  // Ids are the real key; usernames are the fallback for events archived before
  // the snapshot carried ids, and are matched only when no id resolves a row.
  const lookupIds = [...new Set([...roster.map((p) => p.id), snapshotMvpId].filter((id): id is string => !!id))];
  const lookupUsernames = [...new Set(
    [...roster.filter((p) => !p.id).map((p) => p.username), snapshotMvpId ? null : mvpUsername]
      .filter((n): n is string => !!n)
  )];

  const SELECT = "id, username, display_name, discord_id, avatar, status, kick_reason, kicked_until";
  const [{ data: idRows }, { data: nameRows }] = await Promise.all([
    lookupIds.length
      ? supabaseAdmin.from("players").select(SELECT).in("id", lookupIds)
      : Promise.resolve({ data: [] }),
    lookupUsernames.length
      ? supabaseAdmin.from("players").select(SELECT).in("username", lookupUsernames)
      : Promise.resolve({ data: [] }),
  ]);

  type Row = NonNullable<typeof idRows>[number];
  const byId = Object.fromEntries(((idRows ?? []) as Row[]).map((r) => [r.id, r]));
  const byUsername = Object.fromEntries(((nameRows ?? []) as Row[]).map((r) => [r.username, r]));
  const rowFor = (p: SnapshotPlayer): Row | undefined =>
    (p.id ? byId[p.id] : undefined) ?? byUsername[p.username];

  players = roster
    .filter((p) => {
      const row = rowFor(p);
      return !(row && (row.status === "banned" || isCurrentlyKicked(row.kick_reason, row.kicked_until)));
    })
    .map((p) => {
      const row = rowFor(p);
      return {
        id: row?.id ?? p.id ?? null,
        username: p.username,
        displayName: p.displayName ?? row?.display_name ?? null,
        discordId: row?.discord_id ?? null,
        avatar: row?.avatar ?? null,
      };
    });

  mvpPlayerId = snapshotMvpId ?? (mvpUsername ? byUsername[mvpUsername]?.id ?? null : null);

  // Stat leaders for this specific tournament, snapshotted at completion time
  const accolades: Accolade[] = isTournament ? summary.topStats?.accolades ?? [] : [];

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
      sponsoredByLine={<SponsoredByLine tabKey="podium" />}
    />
  );
}
