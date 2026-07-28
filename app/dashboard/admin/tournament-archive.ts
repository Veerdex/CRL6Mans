"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { calculatePlayerRating } from "@/app/lib/rating";
import { ARCHIVE_SCHEMA_VERSION } from "./archive-schema";

export type TournamentArchive = {
  schemaVersion: 1;
  kind: "tournament" | "season";
  exportedAt: string;
  meta: {
    name: string;
    formatPreset: string | null;
    seasonFormat: unknown;
    joinMode: "teams" | "players" | null;
    teamAssignment: "snake_draft" | "auto_balance" | null;
    teamCount: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  teams: {
    id: string;
    name: string;
    logoUrl: string | null;
    wins: number;
    losses: number;
    roster: { username: string; displayName: string | null; isCaptain: boolean; rating: number }[];
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
  const [{ data: allTeams }, { data: allMatches }, { data: allPlayers }, { data: allStats }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, logo_url, wins, losses"),
    supabaseAdmin
      .from("matches")
      .select("id, stage, round, match_number, home_team_id, away_team_id, home_score, away_score, status, scheduled_at, week")
      .order("stage")
      .order("round")
      .order("match_number"),
    supabaseAdmin
      .from("players")
      .select("id, username, display_name, team_id, is_captain, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1"),
    supabaseAdmin
      .from("player_game_stats")
      .select("match_id, game_number, player_id, goals, assists, saves, shots, score")
      .not("player_id", "is", null),
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

  const ratingOf = (p: { peak_1v1?: string | null; current_1v1?: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }) =>
    Math.round(
      calculatePlayerRating({
        at_1v1: Number(p.peak_1v1 ?? 0), season_1v1: Number(p.current_1v1 ?? 0),
        at_2v2: Number(p.peak_2v2 ?? 0), season_2v2: Number(p.current_2v2 ?? 0),
        at_3v3: Number(p.peak_3v3 ?? 0), season_3v3: Number(p.current_3v3 ?? 0),
      }),
    );

  const teams: TournamentArchive["teams"] = participatingTeams.map((t) => ({
    id: t.id,
    name: t.name,
    logoUrl: (t.logo_url as string | null) ?? null,
    wins: t.wins ?? 0,
    losses: t.losses ?? 0,
    roster: (allPlayers ?? [])
      .filter((p) => p.team_id === t.id)
      .map((p) => ({
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
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
    },
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
