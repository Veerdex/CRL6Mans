"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { activateTournamentRuntime } from "@/app/lib/tournament-runtime";
import { computeTopStats, type TopStats } from "@/app/lib/game-stats";
import { resetSeason } from "./league-actions";
import { pushToAllApproved, pushToAdmins, pushToEnteredDraft } from "@/app/lib/push";

export type JoinMode = "teams" | "players";
export type TeamAssignment = "snake_draft" | "auto_balance";

export type TournamentInput = {
  name: string;
  min_teams: number;
  team_limit: number | null;
  join_mode: JoinMode;
  team_assignment: TeamAssignment | null;
  draft_open_at: string | null;
  draft_close_at: string | null;
  draft_start_at: string | null;
  season_start_at: string | null;
  season_format: unknown | null;
  stage_starts: Record<string, string> | null;
  match_spacing_min: number | null;
  match_deadline_day: number | null;
  match_play_day: number | null;
  match_play_hour: number | null;
  min_mmr_2v2: number | null;
  min_mmr_3v3: number | null;
  is_test?: boolean;
};

export type Tournament = TournamentInput & {
  id: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  signups_open: boolean;
  summary: TournamentSummary | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  hidden_from_home: boolean;
  is_test: boolean;
};

export type Season = {
  id: string;
  name: string;
  year: number;
  season_format: unknown | null;
  team_count: number;
  summary: TournamentSummary | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  hidden_from_home: boolean;
};

export type TournamentSummary = {
  champion: string | null;
  runnerUp: string | null;
  finalStandings: { name: string; wins: number; losses: number }[];
  cancellationReason?: string;
  championLogoUrl?: string | null;
  runnerUpLogoUrl?: string | null;
  championPlayers?: { username: string; displayName: string | null }[];
  runnerUpPlayers?: { username: string; displayName: string | null }[];
  topStats?: TopStats;
};

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
  return session;
}

/** Toggle whether a completed tournament or archived season appears on the Home "Past Events" list and the Podium. */
export async function toggleEventVisibility(
  kind: "tournament" | "season",
  id: string,
  hidden: boolean
): Promise<{ ok?: boolean; error?: string; message?: string }> {
  await verifyAdmin();

  const table = kind === "season" ? "seasons" : "tournaments";
  const { error } = await supabaseAdmin
    .from(table)
    .update({ hidden_from_home: hidden })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/podium");
  return { ok: true, message: hidden ? "Hidden from Home & Podium." : "Now visible on Home & Podium." };
}

/** Normalize + validate the config common to create and update. */
function sanitize(input: TournamentInput): { value?: TournamentInput; error?: string } {
  const name = input.name?.trim();
  if (!name) return { error: "Tournament name is required." };
  if (input.join_mode !== "teams" && input.join_mode !== "players")
    return { error: "Invalid join mode." };

  // team_assignment only applies to player-signup tournaments
  let teamAssignment: TeamAssignment | null = null;
  if (input.join_mode === "players") {
    if (input.team_assignment !== "snake_draft" && input.team_assignment !== "auto_balance")
      return { error: "Choose snake draft or auto-balance for player sign-ups." };
    teamAssignment = input.team_assignment;
  }

  const minTeams = Number(input.min_teams);
  if (!Number.isInteger(minTeams) || minTeams < 0)
    return { error: "Min teams must be a non-negative whole number." };

  const teamLimit = input.team_limit != null ? Number(input.team_limit) : null;
  if (teamLimit !== null && (!Number.isInteger(teamLimit) || teamLimit < 0))
    return { error: "Max teams must be a non-negative whole number." };
  if (teamLimit && minTeams && teamLimit < minTeams)
    return { error: "Max teams must be greater than or equal to min teams." };

  const min2v2 = input.min_mmr_2v2 != null && input.min_mmr_2v2 !== (null as unknown) ? Number(input.min_mmr_2v2) : null;
  const min3v3 = input.min_mmr_3v3 != null && input.min_mmr_3v3 !== (null as unknown) ? Number(input.min_mmr_3v3) : null;
  if (min2v2 !== null && (!Number.isInteger(min2v2) || min2v2 < 0 || min2v2 > 3000))
    return { error: "Min 2v2 MMR must be between 0 and 3000." };
  if (min3v3 !== null && (!Number.isInteger(min3v3) || min3v3 < 0 || min3v3 > 3000))
    return { error: "Min 3v3 MMR must be between 0 and 3000." };

  return {
    value: {
      name,
      min_teams: minTeams,
      team_limit: teamLimit || null,
      join_mode: input.join_mode,
      team_assignment: teamAssignment,
      draft_open_at: input.draft_open_at || null,
      draft_close_at: input.draft_close_at || null,
      draft_start_at: input.draft_start_at || null,
      season_start_at: input.season_start_at || null,
      season_format: input.season_format ?? null,
      stage_starts: input.stage_starts ?? null,
      match_spacing_min: null,
      match_deadline_day: null,
      match_play_day: null,
      match_play_hour: null,
      min_mmr_2v2: min2v2 || null,
      min_mmr_3v3: min3v3 || null,
      is_test: input.is_test ?? false,
    },
  };
}

export async function listTournaments(): Promise<Tournament[]> {
  await verifyAdmin();
  const { data } = await supabaseAdmin
    .from("tournaments")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Tournament[];
}

export async function createTournament(input: TournamentInput) {
  await verifyAdmin();
  const { value, error } = sanitize(input);
  if (error) return { error };

  const { error: dbError } = await supabaseAdmin.from("tournaments").insert({
    ...value,
    status: "scheduled",
    updated_at: new Date().toISOString(),
  });
  if (dbError) return { error: dbError.message };

  revalidatePath("/dashboard/admin");
  return { ok: true, message: `Tournament "${value!.name}" scheduled.` };
}

export async function updateTournament(id: string, input: TournamentInput) {
  await verifyAdmin();
  const { value, error } = sanitize(input);
  if (error) return { error };

  const { data: existing } = await supabaseAdmin
    .from("tournaments").select("status").eq("id", id).single();
  if (!existing) return { error: "Tournament not found." };
  if (existing.status !== "scheduled")
    return { error: "Only scheduled tournaments can be edited." };

  const { error: dbError } = await supabaseAdmin
    .from("tournaments")
    .update({ ...value, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (dbError) return { error: dbError.message };

  revalidatePath("/dashboard/admin");
  return { ok: true, message: "Tournament updated." };
}

export async function cancelTournament(id: string) {
  await verifyAdmin();
  const { data: existing } = await supabaseAdmin
    .from("tournaments").select("status").eq("id", id).single();
  if (!existing) return { error: "Tournament not found." };
  if (existing.status === "completed")
    return { error: "Completed tournaments cannot be cancelled." };

  // Cancelling the active tournament aborts it: wipe matches/teams, unassign
  // players, strip Discord roles (via resetSeason), and clear the live pointer.
  if (existing.status === "active") {
    const { data: settings } = await supabaseAdmin
      .from("league_settings").select("active_tournament_id").single();
    if ((settings?.active_tournament_id as string | null) === id) {
      await resetSeason();
      await supabaseAdmin.from("league_settings")
        .update({ active_tournament_id: null, updated_at: new Date().toISOString() })
        .not("id", "is", null);
    }
  }

  const { error } = await supabaseAdmin
    .from("tournaments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true, message: "Tournament cancelled." };
}

export async function openSignups(id: string) {
  await verifyAdmin();
  const { data: t } = await supabaseAdmin.from("tournaments").select("status, signups_closed").eq("id", id).single();
  if (!t) return { error: "Tournament not found." };
  if (t.status !== "scheduled") return { error: "Only scheduled tournaments can open sign-ups." };
  if ((t as { signups_closed?: boolean }).signups_closed) {
    return { error: "Sign-ups have already been closed and cannot be reopened." };
  }

  const { error } = await supabaseAdmin
    .from("tournaments")
    .update({ signups_open: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  const { data: tName } = await supabaseAdmin.from("tournaments").select("name").eq("id", id).single();

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");

  pushToAllApproved({
    title: `${tName?.name ?? "Tournament"} Signups Open`,
    body: "Sign up now before the deadline closes.",
    url: "/dashboard",
    tag: "signups-open",
    category: "tournament",
  }).catch(() => {});

  return { ok: true, message: "Sign-ups opened." };
}

export async function closeSignups(id: string) {
  await verifyAdmin();
  const { data: tName } = await supabaseAdmin.from("tournaments").select("name").eq("id", id).single();

  const { error } = await supabaseAdmin
    .from("tournaments")
    .update({ signups_open: false, signups_closed: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");

  pushToEnteredDraft({
    title: `${tName?.name ?? "Tournament"} Signups Closed`,
    body: "Signups have closed. The draft will begin soon.",
    url: "/dashboard",
    tag: "signups-closed",
    category: "tournament",
  }).catch(() => {});
  pushToAdmins({
    title: `${tName?.name ?? "Tournament"} Signups Closed`,
    body: "Tournament signups have closed.",
    url: "/dashboard/admin",
    tag: "signups-closed-admin",
  }).catch(() => {});

  return { ok: true, message: "Sign-ups closed." };
}

export async function activateTournament(id: string) {
  await verifyAdmin();

  const { data: t } = await supabaseAdmin
    .from("tournaments").select("status, join_mode, name, min_teams, team_limit").eq("id", id).single();
  if (!t) return { error: "Tournament not found." };
  if (t.status !== "scheduled") return { error: "Only scheduled tournaments can be activated." };

  const minTeams: number = (t as { min_teams?: number }).min_teams ?? 0;
  if (minTeams > 0) {
    let actualCount = 0;
    let unit: string;

    if (t.join_mode === "players") {
      const { count } = await supabaseAdmin
        .from("tournament_entries")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", id);
      const playerCount = count ?? 0;
      actualCount = Math.floor(playerCount / 3);
      unit = `teams (${playerCount} players → ${actualCount} teams)`;
    } else {
      const { count } = await supabaseAdmin
        .from("team_signups")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", id);
      actualCount = count ?? 0;
      unit = "teams";
    }

    if (actualCount < minTeams) {
      const reason = `Not enough ${unit} signed up (${actualCount} of ${minTeams} minimum).`;
      await supabaseAdmin.from("tournaments").update({
        status: "cancelled",
        summary: { champion: null, runnerUp: null, finalStandings: [], cancellationReason: reason },
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      revalidatePath("/dashboard/admin");
      revalidatePath("/dashboard");
      return { error: `Cancelled: ${reason}` };
    }
  }

  // Bridge the tournament's joiners into the live runtime.
  const res = await activateTournamentRuntime(id);
  if (!res.ok) return { error: res.error ?? "Failed to activate." };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: t.join_mode === "teams"
      ? `"${t.name}" is now active. Finalize team sign-ups, then start the season.`
      : `"${t.name}" is now active. Its pool is loaded — start the draft or auto-balance.`,
  };
}

/** Champion + final standings derived from completed matches. Snapshots rosters, logos, and stat leaders before reset. */
async function computeSummary(): Promise<TournamentSummary> {
  const [{ data: allTeams }, { data: completedMatches }, topStats] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, logo_url"),
    supabaseAdmin
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score")
      .eq("status", "completed")
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null),
    computeTopStats(),
  ]);

  const records: Record<string, { wins: number; losses: number }> = {};
  for (const m of completedMatches ?? []) {
    if (!m.home_team_id || !m.away_team_id) continue;
    records[m.home_team_id] ??= { wins: 0, losses: 0 };
    records[m.away_team_id] ??= { wins: 0, losses: 0 };
    if ((m.home_score ?? 0) > (m.away_score ?? 0)) {
      records[m.home_team_id].wins++;
      records[m.away_team_id].losses++;
    } else {
      records[m.away_team_id].wins++;
      records[m.home_team_id].losses++;
    }
  }

  const standings = (allTeams ?? [])
    .map((t) => ({
      name: t.name,
      wins: records[t.id]?.wins ?? 0,
      losses: records[t.id]?.losses ?? 0,
    }))
    .filter((t) => t.wins + t.losses > 0)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));

  const championTeam = (allTeams ?? []).find((t) => t.name === standings[0]?.name) ?? null;
  const runnerUpTeam = (allTeams ?? []).find((t) => t.name === standings[1]?.name) ?? null;
  const topIds = [championTeam?.id, runnerUpTeam?.id].filter((id): id is string => !!id);

  const { data: rosterPlayers } = topIds.length
    ? await supabaseAdmin.from("players").select("username, display_name, team_id").in("team_id", topIds)
    : { data: [] as { username: string; display_name: string | null; team_id: string }[] };

  const byTeam = (id: string | undefined) =>
    (rosterPlayers ?? [])
      .filter((p) => p.team_id === id)
      .map((p) => ({ username: p.username, displayName: p.display_name ?? null }));

  return {
    champion: standings[0]?.name ?? null,
    runnerUp: standings[1]?.name ?? null,
    finalStandings: standings,
    championLogoUrl: (championTeam?.logo_url as string | null) ?? null,
    runnerUpLogoUrl: (runnerUpTeam?.logo_url as string | null) ?? null,
    championPlayers: byTeam(championTeam?.id),
    runnerUpPlayers: byTeam(runnerUpTeam?.id),
    topStats,
  };
}

export async function completeTournament() {
  await verifyAdmin();

  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("active_tournament_id").single();
  const activeId = settings?.active_tournament_id as string | null | undefined;
  if (!activeId) return { error: "No active tournament to complete." };

  const { data: tournament } = await supabaseAdmin
    .from("tournaments").select("is_test").eq("id", activeId).single();
  const isTest = tournament?.is_test ?? false;

  if (isTest) {
    // Test tournaments are discarded: no summary saved, hidden from all public views.
    await supabaseAdmin
      .from("tournaments")
      .update({
        status: "completed",
        hidden_from_home: true,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeId);
  } else {
    // Snapshot the summary BEFORE resetSeason wipes the matches/teams.
    const summary = await computeSummary();
    await supabaseAdmin
      .from("tournaments")
      .update({
        status: "completed",
        summary,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeId);
  }

  // Reuse the existing season-reset (wipes matches, unassigns players, strips roles).
  await resetSeason();

  // Clear the live pointer (resetSeason doesn't know about it).
  await supabaseAdmin.from("league_settings")
    .update({ active_tournament_id: null, updated_at: new Date().toISOString() })
    .not("id", "is", null);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  if (isTest) return { ok: true, message: "Test tournament discarded. No records saved." };
  return { ok: true, message: "Tournament completed." };
}

export async function deleteEvent(
  kind: "tournament" | "season",
  id: string
): Promise<{ ok?: boolean; error?: string; message?: string }> {
  await verifyAdmin();

  if (kind === "tournament") {
    const { data: t } = await supabaseAdmin.from("tournaments").select("status, name").eq("id", id).single();
    if (!t) return { error: "Tournament not found." };
    if (t.status === "active") return { error: "Cannot delete an active tournament." };
    if (t.status === "scheduled") return { error: "Cancel the tournament before deleting it." };
    const { error } = await supabaseAdmin.from("tournaments").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard");
    return { ok: true, message: `Deleted "${(t as { name: string }).name}".` };
  } else {
    const { data: s } = await supabaseAdmin.from("seasons").select("name").eq("id", id).single();
    if (!s) return { error: "Season not found." };
    const { error } = await supabaseAdmin.from("seasons").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard");
    return { ok: true, message: `Deleted "${(s as { name: string }).name}".` };
  }
}
