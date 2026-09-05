"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { playerRatingFromRow } from "@/app/lib/rating";
import { fetchAllRows } from "@/app/lib/paginate";
import { computePlacementTiers, placementsFromTiers } from "@/app/lib/placement";
import { prizePoolTotal } from "@/app/lib/career-points";
import { ARCHIVE_SCHEMA_VERSION } from "./archive-schema";

export type TournamentArchive = {
  schemaVersion: 2;
  kind: "tournament" | "season";
  exportedAt: string;
  meta: {
    name: string;
    formatPreset: string | null;
    seasonFormat: unknown;
    joinMode: "teams" | "players" | null;
    teamAssignment: "snake_draft" | "auto_balance" | null;
    teamCount: number;
    /** Distinct players across every participating roster. */
    participantCount: number;
    prize1st: number | null;
    prize2nd: number | null;
    prize3rd4th: number | null;
    /** f for the career-points formula: 3rd-4th pays two teams, so it counts twice. */
    prizePool: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  /**
   * Finishing order, best first, teams the bracket never separated sharing an
   * entry. Kept alongside each team's collapsed placement so a later revision of
   * the midpoint rule can still be recomputed from the event as it was played.
   */
  placementTiers: string[][];
  teams: {
    id: string;
    name: string;
    logoUrl: string | null;
    wins: number;
    losses: number;
    /** Midpoint of the ranks this team's tier spans: 3.5 for a 3rd-4th finish. */
    placement: number;
    /** How many teams shared that placement. */
    placementTierSize: number;
    roster: {
      discordId: string | null;
      username: string;
      displayName: string | null;
      isCaptain: boolean;
      rating: number;
    }[];
  }[];
  matches: {
    id: string;
    stage: string | null;
    round: number;
    matchNumber: number;
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeScore: number | null;
    awayScore: number | null;
    status: string;
    scheduledAt: string | null;
    week: number | null;
  }[];
  playerGameStats: {
    matchId: string;
    gameNumber: number;
    username: string;
    displayName: string | null;
    teamName: string | null;
    goals: number;
    assists: number;
    saves: number;
    shots: number;
    score: number;
    demos: number;
    demoed: number;
  }[];
};

async function assertAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
}

export type ArchiveMeta = {
  kind: "tournament" | "season";
  name: string;
  formatPreset: string | null;
  seasonFormat: unknown;
  joinMode: "teams" | "players" | null;
  teamAssignment: "snake_draft" | "auto_balance" | null;
  prize1st: number | null;
  prize2nd: number | null;
  prize3rd4th: number | null;
  startedAt: string | null;
  endedAt: string | null;
};

/**
 * Snapshot everything needed to fully reconstruct the event later: rosters,
 * ratings, every match (any stage/status, so byes/pending slots reconstruct
 * identically to the live bracket views), and every per-game player stat.
 * Must run BEFORE resetSeason()/completeSeason() wipe matches and teams.
 */
export async function computeFullArchive(meta: ArchiveMeta): Promise<TournamentArchive> {
  const [allTeams, allMatches, allPlayers, allStats] = await Promise.all([
    fetchAllRows((from, to) =>
      supabaseAdmin.from("teams").select("id, name, logo_url, wins, losses").order("id").range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabaseAdmin
        .from("matches")
        .select("id, stage, round, match_number, home_team_id, away_team_id, home_score, away_score, status, scheduled_at, week")
        .order("stage")
        .order("round")
        .order("match_number")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabaseAdmin
        .from("players")
        .select("id, discord_id, username, display_name, team_id, is_captain, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabaseAdmin
        .from("player_game_stats")
        .select("match_id, game_number, player_id, goals, assists, saves, shots, score, demos, demoed")
        .not("player_id", "is", null)
        .order("match_id")
        .order("game_number")
        .order("player_id")
        .range(from, to)
    ),
  ]);

  const playerById = new Map((allPlayers ?? []).map((p) => [p.id, p]));
  const teamById = new Map((allTeams ?? []).map((t) => [t.id, t]));

  const participatingIds = new Set<string>();
  for (const m of allMatches ?? []) {
    if (m.home_team_id) participatingIds.add(m.home_team_id);
    if (m.away_team_id) participatingIds.add(m.away_team_id);
  }
  const participatingTeams = participatingIds.size
    ? (allTeams ?? []).filter((t) => participatingIds.has(t.id))
    : (allTeams ?? []);

  const ratingOf = (p: Parameters<typeof playerRatingFromRow>[0]) => Math.round(playerRatingFromRow(p));

  // Derived from completed matches rather than the teams.wins/losses columns —
  // mirrors season/page.tsx and completeSeason's own finalStandings, since those
  // columns aren't the source of truth the live standings page relies on.
  const records: Record<string, { wins: number; losses: number }> = {};
  for (const m of allMatches ?? []) {
    if (m.status !== "completed" || m.home_score === null || m.away_score === null) continue;
    if (!m.home_team_id || !m.away_team_id) continue;
    records[m.home_team_id] ??= { wins: 0, losses: 0 };
    records[m.away_team_id] ??= { wins: 0, losses: 0 };
    if (m.home_score > m.away_score) {
      records[m.home_team_id].wins++;
      records[m.away_team_id].losses++;
    } else if (m.away_score > m.home_score) {
      records[m.away_team_id].wins++;
      records[m.home_team_id].losses++;
    }
  }

  const placementTiers = computePlacementTiers(
    allMatches ?? [],
    participatingTeams.map((t) => t.id),
  );
  const placements = placementsFromTiers(placementTiers);

  const teams: TournamentArchive["teams"] = participatingTeams.map((t) => ({
    id: t.id,
    name: t.name,
    logoUrl: (t.logo_url as string | null) ?? null,
    wins: records[t.id]?.wins ?? 0,
    losses: records[t.id]?.losses ?? 0,
    placement: placements.get(t.id)?.placement ?? participatingTeams.length,
    placementTierSize: placements.get(t.id)?.tierSize ?? 1,
    roster: (allPlayers ?? [])
      .filter((p) => p.team_id === t.id)
      .map((p) => ({
        // The join key a profile needs. Usernames are mutable, so the archive
        // could not be tied back to an account without this.
        discordId: (p.discord_id as string | null) ?? null,
        username: p.username,
        displayName: p.display_name ?? null,
        isCaptain: p.is_captain ?? false,
        rating: ratingOf(p),
      })),
  }));

  const matches: TournamentArchive["matches"] = (allMatches ?? []).map((m) => ({
    id: m.id,
    stage: m.stage,
    round: m.round,
    matchNumber: m.match_number,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
    homeScore: m.home_score,
    awayScore: m.away_score,
    status: m.status,
    scheduledAt: m.scheduled_at,
    week: m.week,
  }));

  const playerGameStats: TournamentArchive["playerGameStats"] = (allStats ?? []).map((s) => {
    const player = playerById.get(s.player_id as string);
    const teamName = player?.team_id ? (teamById.get(player.team_id)?.name ?? null) : null;
    return {
      matchId: s.match_id,
      gameNumber: s.game_number,
      username: player?.username ?? "Unknown",
      displayName: player?.display_name ?? null,
      teamName,
      goals: s.goals, assists: s.assists, saves: s.saves, shots: s.shots, score: s.score,
      demos: s.demos, demoed: s.demoed,
    };
  });

  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    kind: meta.kind,
    exportedAt: new Date().toISOString(),
    meta: {
      name: meta.name,
      formatPreset: (meta.seasonFormat as { preset?: string } | null)?.preset ?? meta.formatPreset,
      seasonFormat: meta.seasonFormat,
      joinMode: meta.joinMode,
      teamAssignment: meta.teamAssignment,
      teamCount: teams.length,
      participantCount: teams.reduce((n, t) => n + t.roster.length, 0),
      prize1st: meta.prize1st,
      prize2nd: meta.prize2nd,
      prize3rd4th: meta.prize3rd4th,
      prizePool: prizePoolTotal(meta.prize1st, meta.prize2nd, meta.prize3rd4th),
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
    },
    placementTiers,
    teams,
    matches,
    playerGameStats,
  };
}

export async function exportTournamentArchive(
  kind: "tournament" | "season",
  id: string
): Promise<TournamentArchive | null> {
  await assertAdmin();

  const table = kind === "season" ? "seasons" : "tournaments";
  const { data } = await supabaseAdmin.from(table).select("full_archive").eq("id", id).single();
  return (data?.full_archive as TournamentArchive | null) ?? null;
}
