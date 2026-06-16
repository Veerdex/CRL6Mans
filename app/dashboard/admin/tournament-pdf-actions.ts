"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { APP_NAME } from "@/app/lib/constants";

export type PdfStanding = {
  place: number;
  name: string;
  wins: number;
  losses: number;
  logoUrl: string | null;
};

export type PdfMatch = {
  stage: string;
  round: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
};

export type PdfPlayer = { username: string; displayName: string | null };

export type TournamentPdfData = {
  name: string;
  format: string;
  teamCount: number;
  startedAt: string | null;
  endedAt: string | null;
  champion: string | null;
  championLogoUrl: string | null;
  championPlayers: PdfPlayer[];
  runnerUp: string | null;
  runnerUpLogoUrl: string | null;
  runnerUpPlayers: PdfPlayer[];
  standings: PdfStanding[];
  matches: PdfMatch[];
};

const PRESET_NAMES: Record<string, string> = {
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  group_single_elimination: "Group → Single Elimination",
  group_swiss_single_elimination: "Group → Swiss → SE",
  se_swiss_single_elimination: "SE Qualifier → Swiss → SE",
  de_swiss_single_elimination: "DE Qualifier → Swiss → SE",
};

async function assertAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirector(session.userId))) redirect("/dashboard");
}

export async function fetchCompletedTournamentPdfData(
  tournamentId: string
): Promise<TournamentPdfData | null> {
  await assertAdmin();

  const [{ data: t }, { data: allTeams }] = await Promise.all([
    supabaseAdmin
      .from("tournaments")
      .select("name, season_format, started_at, ended_at, summary")
      .eq("id", tournamentId)
      .single(),
    supabaseAdmin.from("teams").select("name, logo_url"),
  ]);

  if (!t) return null;

  const summary = t.summary as {
    champion?: string | null;
    runnerUp?: string | null;
    finalStandings?: { name: string; wins: number; losses: number }[];
    championPlayers?: PdfPlayer[];
    runnerUpPlayers?: PdfPlayer[];
  } | null;

  const logoByName = Object.fromEntries(
    (allTeams ?? []).map((team) => [team.name, (team.logo_url as string | null) ?? null])
  );

  const rawStandings = summary?.finalStandings ?? [];
  const standings: PdfStanding[] = rawStandings.map((row, i) => ({
    place: i + 1,
    name: row.name,
    wins: row.wins,
    losses: row.losses,
    logoUrl: logoByName[row.name] ?? null,
  }));

  const sf = t.season_format as { preset?: string } | null;
  const champion = summary?.champion ?? null;
  const runnerUp = summary?.runnerUp ?? null;

  return {
    name: t.name,
    format: PRESET_NAMES[sf?.preset ?? ""] ?? sf?.preset ?? "Tournament",
    teamCount: standings.length,
    startedAt: t.started_at,
    endedAt: t.ended_at,
    champion,
    championLogoUrl: champion ? (logoByName[champion] ?? null) : null,
    championPlayers: summary?.championPlayers ?? [],
    runnerUp,
    runnerUpLogoUrl: runnerUp ? (logoByName[runnerUp] ?? null) : null,
    runnerUpPlayers: summary?.runnerUpPlayers ?? [],
    standings,
    matches: [],
  };
}

export async function fetchActiveTournamentPdfData(): Promise<TournamentPdfData | null> {
  await assertAdmin();

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("active_tournament_id")
    .single();

  const activeId = settings?.active_tournament_id as string | null | undefined;
  if (!activeId) return null;

  const [{ data: t }, { data: allTeams }, { data: completedMatches }] = await Promise.all([
    supabaseAdmin
      .from("tournaments")
      .select("name, season_format, started_at")
      .eq("id", activeId)
      .single(),
    supabaseAdmin.from("teams").select("id, name, wins, losses, logo_url"),
    supabaseAdmin
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score, stage, round, match_number")
      .eq("status", "completed")
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null)
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("stage")
      .order("round")
      .order("match_number"),
  ]);

  if (!t) return null;

  const teamById = Object.fromEntries(
    (allTeams ?? []).map((team) => [
      team.id,
      { name: team.name, logoUrl: (team.logo_url as string | null) ?? null },
    ])
  );

  const standings: PdfStanding[] = (allTeams ?? [])
    .filter((team) => (team.wins ?? 0) + (team.losses ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.wins ?? 0) - (a.wins ?? 0) ||
        (a.losses ?? 0) - (b.losses ?? 0) ||
        a.name.localeCompare(b.name)
    )
    .map((team, i) => ({
      place: i + 1,
      name: team.name,
      wins: team.wins ?? 0,
      losses: team.losses ?? 0,
      logoUrl: (team.logo_url as string | null) ?? null,
    }));

  const matches: PdfMatch[] = (completedMatches ?? []).map((m) => ({
    stage: String(m.stage ?? ""),
    round: `Round ${m.round}`,
    home: teamById[m.home_team_id as string]?.name ?? "Unknown",
    away: teamById[m.away_team_id as string]?.name ?? "Unknown",
    homeScore: (m.home_score as number) ?? 0,
    awayScore: (m.away_score as number) ?? 0,
  }));

  const sf = t.season_format as { preset?: string } | null;
  const champion = standings[0]?.name ?? null;
  const runnerUp = standings[1]?.name ?? null;

  const topIds = standings.slice(0, 2)
    .map((s) => (allTeams ?? []).find((t) => t.name === s.name)?.id)
    .filter((id): id is string => !!id);
  const { data: rosterPlayers } = topIds.length
    ? await supabaseAdmin.from("players").select("username, display_name, team_id").in("team_id", topIds)
    : { data: [] as { username: string; display_name: string | null; team_id: string }[] };

  const championId = (allTeams ?? []).find((t) => t.name === champion)?.id;
  const runnerUpId = (allTeams ?? []).find((t) => t.name === runnerUp)?.id;
  const byTeam = (id: string | undefined): PdfPlayer[] =>
    (rosterPlayers ?? []).filter((p) => p.team_id === id).map((p) => ({ username: p.username, displayName: p.display_name ?? null }));

  return {
    name: t.name,
    format: PRESET_NAMES[sf?.preset ?? ""] ?? sf?.preset ?? "Tournament",
    teamCount: standings.length,
    startedAt: t.started_at,
    endedAt: null,
    champion,
    championLogoUrl: standings[0]?.logoUrl ?? null,
    championPlayers: byTeam(championId),
    runnerUp,
    runnerUpLogoUrl: standings[1]?.logoUrl ?? null,
    runnerUpPlayers: byTeam(runnerUpId),
    standings,
    matches,
  };
}

/**
 * PDF data for a manually-run season (started via League Controls, not a tournament).
 * Mirrors fetchActiveTournamentPdfData but sources everything from live state, since
 * there is no tournament row behind a manual season.
 */
export async function fetchActiveSeasonPdfData(): Promise<TournamentPdfData | null> {
  await assertAdmin();

  const [{ data: settings }, { data: allTeams }, { data: completedMatches }] = await Promise.all([
    supabaseAdmin.from("league_settings").select("season_format, season_active").single(),
    supabaseAdmin.from("teams").select("id, name, wins, losses, logo_url"),
    supabaseAdmin
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score, stage, round, match_number")
      .eq("status", "completed")
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null)
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("stage")
      .order("round")
      .order("match_number"),
  ]);

  if (!settings?.season_active) return null;

  const teamById = Object.fromEntries(
    (allTeams ?? []).map((team) => [
      team.id,
      { name: team.name, logoUrl: (team.logo_url as string | null) ?? null },
    ])
  );

  const standings: PdfStanding[] = (allTeams ?? [])
    .filter((team) => (team.wins ?? 0) + (team.losses ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.wins ?? 0) - (a.wins ?? 0) ||
        (a.losses ?? 0) - (b.losses ?? 0) ||
        a.name.localeCompare(b.name)
    )
    .map((team, i) => ({
      place: i + 1,
      name: team.name,
      wins: team.wins ?? 0,
      losses: team.losses ?? 0,
      logoUrl: (team.logo_url as string | null) ?? null,
    }));

  const matches: PdfMatch[] = (completedMatches ?? []).map((m) => ({
    stage: String(m.stage ?? ""),
    round: `Round ${m.round}`,
    home: teamById[m.home_team_id as string]?.name ?? "Unknown",
    away: teamById[m.away_team_id as string]?.name ?? "Unknown",
    homeScore: (m.home_score as number) ?? 0,
    awayScore: (m.away_score as number) ?? 0,
  }));

  const sf = settings.season_format as { preset?: string } | null;
  const champion = standings[0]?.name ?? null;
  const runnerUp = standings[1]?.name ?? null;

  const topIds = standings.slice(0, 2)
    .map((s) => (allTeams ?? []).find((t) => t.name === s.name)?.id)
    .filter((id): id is string => !!id);
  const { data: rosterPlayers } = topIds.length
    ? await supabaseAdmin.from("players").select("username, display_name, team_id").in("team_id", topIds)
    : { data: [] as { username: string; display_name: string | null; team_id: string }[] };

  const championId = (allTeams ?? []).find((t) => t.name === champion)?.id;
  const runnerUpId = (allTeams ?? []).find((t) => t.name === runnerUp)?.id;
  const byTeam = (id: string | undefined): PdfPlayer[] =>
    (rosterPlayers ?? []).filter((p) => p.team_id === id).map((p) => ({ username: p.username, displayName: p.display_name ?? null }));

  return {
    name: `${APP_NAME} Season ${new Date().getFullYear()}`,
    format: PRESET_NAMES[sf?.preset ?? ""] ?? sf?.preset ?? "Season",
    teamCount: standings.length,
    startedAt: null,
    endedAt: new Date().toISOString(),
    champion,
    championLogoUrl: standings[0]?.logoUrl ?? null,
    championPlayers: byTeam(championId),
    runnerUp,
    runnerUpLogoUrl: standings[1]?.logoUrl ?? null,
    runnerUpPlayers: byTeam(runnerUpId),
    standings,
    matches,
  };
}

export async function purgeTournamentStandings(
  id: string
): Promise<{ ok?: boolean; error?: string }> {
  await assertAdmin();

  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("summary, status")
    .eq("id", id)
    .single();

  if (!t) return { error: "Tournament not found." };
  if (t.status !== "completed") return { error: "Only completed tournaments can be archived." };

  const existing = t.summary as { champion?: string | null; runnerUp?: string | null } | null;

  const { error } = await supabaseAdmin
    .from("tournaments")
    .update({
      summary: {
        champion: existing?.champion ?? null,
        runnerUp: existing?.runnerUp ?? null,
        finalStandings: [],
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
