"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { execStartDraft, execEndDraft, execStartSeason, execAutoBalanceTeams, deleteMatchChannels, execSyncRoles, voidAllPendingWagers } from "@/app/lib/discord-bot";
import { editRole, getGuildRoles, removeRoleById, getMemberRoleIds } from "@/app/lib/discord-api";
import { pushToAllApproved, pushToAdmins, pushToEnteredDraft } from "@/app/lib/push";
import { APP_NAME } from "@/app/lib/constants";
import { computeTopStats } from "@/app/lib/game-stats";

const TEAM_ROLE_COLOR = 0x3498db; // blue
import { supabaseAdmin } from "@/app/lib/supabase";

const NAMES_A = ["Arctic", "Blazing", "Chrome", "Dark", "Eclipse", "Frost", "Ghost", "Hyper", "Iron", "Jade", "Kinetic", "Lunar", "Mystic", "Neon", "Orbital"];
const NAMES_B = ["Ace", "Blaze", "Claw", "Dragon", "Falcon", "Gear", "Hawk", "Ion", "Jaguar", "Lance", "Mach", "Nova", "Orbit", "Pulse", "Viper"];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function addTestUser() {
  await verifyAdmin();

  const name = NAMES_A[rand(0, NAMES_A.length - 1)] + NAMES_B[rand(0, NAMES_B.length - 1)];
  const suffix = Math.random().toString(36).slice(2, 6);
  const username = `${name}_${suffix}`;
  const discordId = `test_${Date.now()}_${suffix}`;

  const peak3v3 = rand(800, 1500);
  const peak2v2 = rand(800, 1500);

  const { error } = await supabaseAdmin.from("players").insert({
    discord_id: discordId,
    username,
    avatar: null,
    status: "approved",
    draft_entered: true,
    tracker_url: "https://rocketleague.tracker.network",
    peak_3v3: String(peak3v3),
    current_3v3: String(peak3v3 - rand(0, 150)),
    peak_2v2: String(peak2v2),
    current_2v2: String(peak2v2 - rand(0, 150)),
    college_image_url: "",
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: `Failed: ${error.message}` };
  revalidatePath("/dashboard/players");
  return { ok: true, message: `Added test player: ${username} (3v3 peak: ${peak3v3}, 2v2 peak: ${peak2v2})` };
}

export async function addBulkTestUsers(count = 32) {
  await verifyAdmin();

  const now = Date.now();
  const rows = Array.from({ length: count }, (_, i) => {
    const name = NAMES_A[rand(0, NAMES_A.length - 1)] + NAMES_B[rand(0, NAMES_B.length - 1)];
    const suffix = Math.random().toString(36).slice(2, 6);
    const peak3v3 = rand(800, 1500);
    const peak2v2 = rand(800, 1500);
    return {
      discord_id: `test_${now}_${i}_${suffix}`,
      username: `${name}_${suffix}`,
      avatar: null,
      status: "approved",
      draft_entered: true,
      tracker_url: "https://rocketleague.tracker.network",
      peak_3v3: String(peak3v3),
      current_3v3: String(peak3v3 - rand(0, 150)),
      peak_2v2: String(peak2v2),
      current_2v2: String(peak2v2 - rand(0, 150)),
      college_image_url: "",
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabaseAdmin.from("players").insert(rows);
  if (error) return { error: `Failed: ${error.message}` };
  revalidatePath("/dashboard/players");
  return { ok: true, message: `Added ${count} test players.` };
}

export async function generateTestTeams() {
  await verifyAdmin();

  const { data: players } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("status", "approved")
    .eq("draft_entered", true)
    .order("created_at");

  if (!players?.length) return { error: "No players in the draft pool." };

  // Fetch every team, sort by slot_number (nulls last) then id for stability,
  // and assign a canonical number — this handles teams renamed before the
  // slot_number column was backfilled.
  const { data: allTeams } = await supabaseAdmin
    .from("teams")
    .select("id, name, discord_role_id, slot_number");

  if (!allTeams?.length) return { error: "No team slots configured. Add them in the Team Slots panel first." };

  const sortedTeams = [...allTeams]
    .sort((a, b) => {
      if (a.slot_number !== null && b.slot_number !== null) return a.slot_number - b.slot_number;
      if (a.slot_number !== null) return -1;
      if (b.slot_number !== null) return 1;
      return a.id.localeCompare(b.id);
    })
    .map((t, i) => ({ ...t, num: t.slot_number ?? (i + 1) }));

  // Honor the admin's configured team count. Only fall back to the physical max
  // (slots / players) when the admin hasn't set a value yet.
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("num_teams").single();
  const configured = (settings?.num_teams as number) ?? 0;
  const maxFeasible = Math.min(sortedTeams.length, Math.floor(players.length / 3));

  let numTeams: number;
  if (configured > 0) {
    if (configured > sortedTeams.length)
      return { error: `Configured for ${configured} teams but only ${sortedTeams.length} team slot${sortedTeams.length === 1 ? "" : "s"} exist. Add more slots or lower the team count.` };
    if (configured * 3 > players.length)
      return { error: `${configured} teams requires ${configured * 3} players in the draft pool (currently ${players.length}).` };
    numTeams = configured;
  } else {
    numTeams = maxFeasible;
  }
  if (numTeams < 1) return { error: "Need at least 3 players in the draft pool." };

  const teamsToUse = sortedTeams.slice(0, numTeams);

  // Wipe matches (FK references teams) and reset all player assignments
  await supabaseAdmin.from("matches").delete().gte("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin
    .from("players")
    .update({ team_id: null, is_captain: false })
    .gte("id", "00000000-0000-0000-0000-000000000000");

  // Reset names, logos, and win/loss for every slot being used.
  // Also writes slot_number if it was missing, so future runs don't need this fallback.
  await Promise.all(teamsToUse.map(team =>
    supabaseAdmin.from("teams").update({
      wins: 0,
      losses: 0,
      name: `Team ${team.num}`,
      logo_url: null,
      logo_offset_x: 50,
      logo_offset_y: 50,
      ...(team.slot_number === null ? { slot_number: team.num } : {}),
    }).eq("id", team.id)
  ));

  // Rename Discord roles in parallel (editRole self-throttles on rate limits)
  await Promise.all(
    teamsToUse
      .filter(t => t.discord_role_id)
      .map(t => editRole(t.discord_role_id!, { name: `Team ${t.num}` }))
  );

  // Strip all team / Drafted / Captain roles from every real (non-test) approved player
  // so no one ends up with roles from a previous draft after reassignment.
  const { data: allApprovedPlayers } = await supabaseAdmin
    .from("players")
    .select("discord_id")
    .eq("status", "approved")
    .not("discord_id", "is", null);

  // Test users have fake IDs like "test_..." — skip them to avoid wasted Discord API calls
  const realDiscordIds = (allApprovedPlayers ?? [])
    .map(p => p.discord_id as string)
    .filter(id => id && !id.startsWith("test_"));

  if (realDiscordIds.length > 0) {
    const guildRoles = await getGuildRoles();
    const roleIdsToStrip = [
      ...guildRoles
        .filter(r => r.name === "Drafted" || r.name === "Captain")
        .map(r => r.id),
      ...(allTeams ?? [])
        .map(t => t.discord_role_id)
        .filter((id): id is string => !!id),
    ];
    if (roleIdsToStrip.length > 0) {
      // Process 5 users at a time; all roles for each user are parallel within the batch
      const BATCH = 5;
      for (let i = 0; i < realDiscordIds.length; i += BATCH) {
        await Promise.all(
          realDiscordIds.slice(i, i + BATCH).flatMap(uid =>
            roleIdsToStrip.map(rid => removeRoleById(uid, rid))
          )
        );
      }
    }
  }

  // Assign exactly numTeams * 3 players round-robin so every team gets exactly 3
  const toAssign = players.slice(0, numTeams * 3);
  const byTeam = teamsToUse.map((team, i) => ({
    teamId: team.id,
    ids: toAssign.filter((_, j) => j % numTeams === i).map(p => p.id),
  }));

  await Promise.all(byTeam.map(({ teamId, ids }) =>
    supabaseAdmin.from("players").update({ team_id: teamId }).in("id", ids)
  ));
  await Promise.all(
    byTeam.filter(({ ids }) => ids.length > 0).map(({ ids }) =>
      supabaseAdmin.from("players").update({ is_captain: true }).eq("id", ids[0])
    )
  );

  await supabaseAdmin.from("league_settings").update({
    // Preserve the admin's configured count; only write when we auto-computed it.
    ...(configured > 0 ? {} : { num_teams: numTeams }),
    draft_active: false,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/players");

  // Assign Discord roles using stored role IDs
  await execSyncRoles();

  const assigned = numTeams * 3;
  const skipped = players.length - assigned;
  const missingRoleIds = teamsToUse.filter(t => !t.discord_role_id).length;
  const roleWarning = missingRoleIds > 0 ? ` ⚠ ${missingRoleIds} team${missingRoleIds > 1 ? "s" : ""} missing role ID — Discord roles not assigned for those.` : "";
  return { ok: true, message: `Generated ${numTeams} teams (${assigned} players assigned${skipped > 0 ? `, ${skipped} unassigned` : ""}).${roleWarning}` };
}

export async function addBulkTournamentTestUsers(tournamentId: string, count = 32) {
  await verifyAdmin();

  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("join_mode")
    .eq("id", tournamentId)
    .single();
  if (!t) return { error: "Tournament not found." };
  if (t.join_mode !== "players") return { error: "Only player-signup tournaments support test users." };

  const now = Date.now();
  const rows = Array.from({ length: count }, (_, i) => {
    const name = NAMES_A[rand(0, NAMES_A.length - 1)] + NAMES_B[rand(0, NAMES_B.length - 1)];
    const suffix = Math.random().toString(36).slice(2, 6);
    const peak3v3 = rand(800, 1500);
    const peak2v2 = rand(800, 1500);
    return {
      discord_id: `test_${now}_${i}_${suffix}`,
      username: `${name}_${suffix}`,
      avatar: null,
      status: "approved",
      draft_entered: false,
      tracker_url: "https://rocketleague.tracker.network",
      peak_3v3: String(peak3v3),
      current_3v3: String(peak3v3 - rand(0, 150)),
      peak_2v2: String(peak2v2),
      current_2v2: String(peak2v2 - rand(0, 150)),
      college_image_url: "",
      updated_at: new Date().toISOString(),
    };
  });

  const { data: inserted, error } = await supabaseAdmin.from("players").insert(rows).select("id");
  if (error || !inserted) return { error: error?.message ?? "Failed to create players." };

  const entries = inserted.map((p: { id: string }) => ({
    tournament_id: tournamentId,
    player_id: p.id,
  }));
  const { error: entryError } = await supabaseAdmin.from("tournament_entries").insert(entries);
  if (entryError) return { error: entryError.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/tournament");
  return { ok: true, message: `Added ${count} test players to this tournament.` };
}

export async function removeTestUsers() {
  await verifyAdmin();

  const { data, error } = await supabaseAdmin
    .from("players")
    .delete()
    .like("discord_id", "test_%")
    .select("id");

  if (error) return { error: "Failed to remove test users." };
  revalidatePath("/dashboard/players");
  return { ok: true, message: `Removed ${data?.length ?? 0} test user(s).` };
}

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirector(session.userId))) redirect("/dashboard");
  return session;
}

// Blank → "max" (build as many teams as the pool/slots allow). A positive integer
// caps the team count. Anything else is rejected.
function parseMaxTeams(raw?: string): number | "max" | "invalid" {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return "max";
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return "invalid";
  return n;
}

export async function adminStartDraft(code: string, maxTeamsRaw?: string) {
  await verifyAdmin();
  if (code !== "CONFIRM DRAFT") return { error: 'Type exactly: CONFIRM DRAFT' };
  const maxTeams = parseMaxTeams(maxTeamsRaw);
  if (maxTeams === "invalid")
    return { error: "Enter a whole number ≥ 1 for max teams, or leave it blank for the maximum." };
  const result = await execStartDraft(maxTeams);
  if (result.ok) {
    revalidatePath("/dashboard/teams");
    revalidatePath("/dashboard/draft");
    pushToEnteredDraft({
      title: "Draft Starting!",
      body: `The ${APP_NAME} draft is now live. Head to the draft page to watch your team get picked.`,
      url: "/dashboard/draft",
      tag: "draft-start",
      category: "draft",
    }).catch(() => {});
    pushToAdmins({
      title: "Draft Starting!",
      body: "The draft is now live.",
      url: "/dashboard/draft",
      tag: "draft-start-admin",
    }).catch(() => {});
  }
  return result;
}

export async function adminAutoBalance(code: string, maxTeamsRaw?: string) {
  await verifyAdmin();
  if (code !== "AUTO DRAFT") return { error: "Type exactly: AUTO DRAFT" };
  const maxTeams = parseMaxTeams(maxTeamsRaw);
  if (maxTeams === "invalid")
    return { error: "Enter a whole number ≥ 1 for max teams, or leave it blank for the maximum." };
  const result = await execAutoBalanceTeams(maxTeams);
  if (result.ok) {
    revalidatePath("/dashboard/teams");
    revalidatePath("/dashboard/players");
    revalidatePath("/dashboard/draft");
  }
  return result;
}

export async function adminEndDraft(code: string) {
  await verifyAdmin();
  if (code !== "END DRAFT") return { error: 'Type exactly: END DRAFT' };
  const result = await execEndDraft();
  if (result.ok) {
    revalidatePath("/dashboard/teams");
    pushToEnteredDraft({
      title: "Draft Complete",
      body: "Teams have been finalized. Check your team on the My Team page.",
      url: "/dashboard/my-team",
      tag: "draft-end",
      category: "draft",
    }).catch(() => {});
    pushToAdmins({
      title: "Draft Complete",
      body: "Teams have been finalized.",
      url: "/dashboard/teams",
      tag: "draft-end-admin",
    }).catch(() => {});
  }
  return result;
}

export async function adminStartSeason(code: string) {
  await verifyAdmin();
  if (code !== "START SEASON") return { error: 'Type exactly: START SEASON' };
  const result = await execStartSeason();
  if (result.ok) {
    pushToAllApproved({
      title: "Season Started!",
      body: `The ${APP_NAME} season is now live. Check the schedule for your upcoming matches.`,
      url: "/dashboard/season",
      tag: "season-start",
      category: "season",
    }).catch(() => {});
  }
  return result;
}

export async function openDraftSignups() {
  await verifyAdmin();

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("draft_active, season_active")
    .single();

  if (settings?.draft_active) {
    return { error: "Signups cannot be reopened while the draft is in progress." };
  }
  if (settings?.season_active) {
    return { error: "Signups cannot be reopened while a season is active." };
  }

  await supabaseAdmin.from("league_settings").update({
    draft_open: true,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");

  pushToAllApproved({
    title: "Season Signups Open",
    body: `${APP_NAME} season signups are now open. Head to the dashboard to enter the pool.`,
    url: "/dashboard",
    tag: "signups-open",
    category: "tournament",
  }).catch(() => {});

  return { ok: true, message: "Draft signups are now open. Players can enter the draft pool." };
}

export async function closeDraftSignups() {
  await verifyAdmin();
  await supabaseAdmin.from("league_settings").update({
    draft_open: false,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");

  pushToEnteredDraft({
    title: "Season Signups Closed",
    body: "Season signups have closed. The draft will begin soon.",
    url: "/dashboard",
    tag: "signups-closed",
    category: "tournament",
  }).catch(() => {});
  pushToAdmins({
    title: "Season Signups Closed",
    body: "Season signups have closed.",
    url: "/dashboard/admin",
    tag: "signups-closed-admin",
  }).catch(() => {});

  return { ok: true, message: "Draft signups closed." };
}

/**
 * Force every player who joined the active event (rostered players, the draft
 * pool, and any requested subs) to re-verify their tracker before their next
 * replay submission. The flag is cleared when a player re-confirms/updates their
 * tracker, or automatically when the event ends (resetSeason).
 */
export async function forceTrackerUpdate(): Promise<{ ok?: boolean; error?: string; message?: string }> {
  await verifyAdmin();

  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_active, active_tournament_id").single();
  const eventActive = (settings?.season_active ?? false) || !!settings?.active_tournament_id;
  if (!eventActive) return { error: "No active tournament or season — nothing to do." };

  const [{ data: rostered }, { data: subReqs }] = await Promise.all([
    supabaseAdmin.from("players").select("id").eq("status", "approved").or("team_id.not.is.null,draft_entered.eq.true"),
    supabaseAdmin.from("sub_requests").select("sub_player_id, sub_player_ids").neq("status", "rejected"),
  ]);

  const ids = new Set<string>();
  for (const p of rostered ?? []) ids.add(p.id);
  for (const r of subReqs ?? []) {
    if (r.sub_player_id) ids.add(r.sub_player_id as string);
    for (const sid of ((r.sub_player_ids as string[] | null) ?? [])) ids.add(sid);
  }

  if (ids.size === 0) return { error: "No active players found to flag." };

  const { error } = await supabaseAdmin
    .from("players")
    .update({ must_update_tracker: true, updated_at: new Date().toISOString() })
    .in("id", [...ids]);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/my-team");
  return { ok: true, message: `Flagged ${ids.size} player${ids.size === 1 ? "" : "s"} to re-verify their tracker.` };
}

export async function resetSeason() {
  await verifyAdmin();

  // Delete Discord match channels before wiping the DB
  await deleteMatchChannels();

  // Refund and void any bets still pending — the matches they reference are about
  // to be deleted, so nothing will ever settle them otherwise.
  await voidAllPendingWagers();

  // Delete matches and reset team stats — team slots (name, discord_role_id) are preserved
  await supabaseAdmin.from("sub_requests").delete().not("id", "is", null);
  await supabaseAdmin.from("matches").delete().not("id", "is", null);
  await supabaseAdmin.from("teams").update({ wins: 0, losses: 0, is_locked: false }).not("id", "is", null);

  // Reset all player assignments, draft entries, and pending coin grants
  await supabaseAdmin
    .from("players")
    .update({ team_id: null, is_captain: false, draft_entered: false, draft_entered_at: null, in_active_draft: false, must_update_tracker: false, coin_grant_pending_start: false, coin_grant_pending_weekly: false })
    .not("id", "is", null);

  // Strip all team-related Discord roles from every real player so nobody keeps
  // a team role after the reset. (Only removes roles each member actually has.)
  await stripTeamRolesFromPlayers();

  // Reset ALL draft/season state so nothing looks active or in-progress
  await supabaseAdmin.from("league_settings").update({
    draft_open: false,
    draft_signups_closed: false,
    draft_active: false,
    season_active: false,
    is_test_season: false,
    num_teams: 0,
    current_pick: 0,
    draft_phase: null,
    nominated_player_id: null,
    current_bid: null,
    current_bid_team_id: null,
    current_bid_time: null,
    pick_deadline: null,
    pending_start_coin_amount: 0,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/players");
  return { ok: true, message: "Season reset. Players unassigned, draft cleared." };
}

/**
 * End a manual season: snapshot final standings into the `seasons` archive
 * (mirrors completeTournament's summary), then reset the league. The archive
 * row is the permanent record once the live data is wiped.
 */
export async function completeSeason(): Promise<{ ok?: boolean; error?: string; message?: string }> {
  await verifyAdmin();

  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_active, season_format, is_test_season").single();
  if (!settings?.season_active) return { error: "No active season to complete." };

  // Snapshot standings, logos, rosters, and stat leaders BEFORE resetSeason wipes matches/teams.
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

  const finalStandings = (allTeams ?? [])
    .map((t) => ({ name: t.name, wins: records[t.id]?.wins ?? 0, losses: records[t.id]?.losses ?? 0 }))
    .filter((t) => t.wins + t.losses > 0)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));

  const championTeam = (allTeams ?? []).find((t) => t.name === finalStandings[0]?.name) ?? null;
  const runnerUpTeam = (allTeams ?? []).find((t) => t.name === finalStandings[1]?.name) ?? null;
  const topIds = [championTeam?.id, runnerUpTeam?.id].filter((id): id is string => !!id);
  const { data: rosterPlayers } = topIds.length
    ? await supabaseAdmin.from("players").select("username, display_name, team_id").in("team_id", topIds)
    : { data: [] as { username: string; display_name: string | null; team_id: string }[] };

  const byTeam = (id: string | undefined) =>
    (rosterPlayers ?? [])
      .filter((p) => p.team_id === id)
      .map((p) => ({ username: p.username, displayName: p.display_name ?? null }));

  const year = new Date().getFullYear();
  const name = `${APP_NAME} Season ${year}`;

  if (settings.is_test_season) {
    // Test season: skip archive, just wipe.
    await resetSeason();
    return { ok: true, message: "Test season discarded. No records saved." };
  }

  const { error: archiveError } = await supabaseAdmin.from("seasons").insert({
    name,
    year,
    season_format: settings.season_format ?? null,
    team_count: finalStandings.length,
    summary: {
      champion: finalStandings[0]?.name ?? null,
      runnerUp: finalStandings[1]?.name ?? null,
      finalStandings,
      championLogoUrl: (championTeam?.logo_url as string | null) ?? null,
      runnerUpLogoUrl: (runnerUpTeam?.logo_url as string | null) ?? null,
      championPlayers: byTeam(championTeam?.id),
      runnerUpPlayers: byTeam(runnerUpTeam?.id),
      topStats,
    },
    ended_at: new Date().toISOString(),
  });
  if (archiveError) return { error: `Failed to archive season: ${archiveError.message}` };

  // Only wipe once the archive is safely written.
  await resetSeason();

  return { ok: true, message: `Season archived as "${name}".` };
}

export async function addTeamSlot(discordRoleId: string) {
  await verifyAdmin();
  if (!discordRoleId.trim()) return { error: "A Discord role ID is required." };
  const { data: existing } = await supabaseAdmin.from("teams").select("slot_number").not("slot_number", "is", null);
  const nums = (existing ?? []).map(t => t.slot_number as number);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  const { data: newTeam, error } = await supabaseAdmin
    .from("teams")
    .insert({ name: `Team ${next}`, discord_role_id: discordRoleId, is_locked: false, slot_number: next })
    .select("id, name, discord_role_id, slot_number")
    .single();
  if (error || !newTeam) return { error: error?.message ?? "Failed to create team." };
  const canonicalName = `Team ${next}`;
  try {
    const guildRoles = await getGuildRoles();
    const currentName = guildRoles.find(r => r.id === discordRoleId)?.name;
    const updates: { name?: string; color: number } = { color: TEAM_ROLE_COLOR };
    if (currentName !== canonicalName) updates.name = canonicalName;
    await editRole(discordRoleId, updates);
  } catch {
    // Discord role update failed — team is saved; admin should rename the role manually
  }
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/teams");
  return { ok: true, team: newTeam as { id: string; name: string; discord_role_id: string | null; slot_number: number | null } };
}

export async function updateTeamRoleId(teamId: string, discordRoleId: string) {
  await verifyAdmin();
  const { data: team } = await supabaseAdmin.from("teams").select("name").eq("id", teamId).single();
  const { error } = await supabaseAdmin
    .from("teams")
    .update({ discord_role_id: discordRoleId || null })
    .eq("id", teamId);
  if (error) return { error: error.message };
  if (discordRoleId && team) {
    try {
      const guildRoles = await getGuildRoles();
      const currentName = guildRoles.find(r => r.id === discordRoleId)?.name;
      const updates: { name?: string; color: number } = { color: TEAM_ROLE_COLOR };
      if (currentName !== team.name) updates.name = team.name;
      await editRole(discordRoleId, updates);
    } catch {
      // Discord role update failed — DB is saved; role name/color may be out of sync
    }
  }
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function deleteAllTeamSlots() {
  await verifyAdmin();
  await supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).gte("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("matches").delete().gte("id", "00000000-0000-0000-0000-000000000000");
  const { error } = await supabaseAdmin.from("teams").delete().gte("id", "00000000-0000-0000-0000-000000000000");
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/teams");
  return { ok: true, message: "All team slots deleted." };
}

export async function deleteLastTeamSlot() {
  await verifyAdmin();
  const { data: teams } = await supabaseAdmin
    .from("teams").select("id, name, slot_number").not("slot_number", "is", null);
  const numbered = (teams ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .map(t => ({ id: t.id, name: t.name, num: t.slot_number }))
    .sort((a, b) => b.num - a.num);
  if (!numbered.length) return { error: "No numbered teams to delete." };
  const last = numbered[0];
  const { count } = await supabaseAdmin
    .from("players").select("*", { count: "exact", head: true }).eq("team_id", last.id);
  if ((count ?? 0) > 0) return { error: `Team ${last.num} still has players assigned. Remove them first.` };
  const { error } = await supabaseAdmin.from("teams").delete().eq("id", last.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/teams");
  return { ok: true, message: `Team ${last.num} deleted.` };
}

export async function initLeagueSettings(): Promise<{ ok?: boolean; error?: string }> {
  await verifyAdmin();
  const { data: existing } = await supabaseAdmin
    .from("league_settings").select("id").maybeSingle();
  if (existing) return { ok: true };
  const { error } = await supabaseAdmin.from("league_settings").insert({
    draft_open: false,
    draft_active: false,
    season_active: false,
    num_teams: 0,
    current_pick: 0,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function forceResetDraftState(): Promise<{ ok?: boolean; error?: string }> {
  await verifyAdmin();
  const [{ error: settingsErr }, { error: playersErr }] = await Promise.all([
    supabaseAdmin.from("league_settings").update({
      draft_active: false,
      draft_phase: null,
      pick_deadline: null,
      current_pick: 0,
      updated_at: new Date().toISOString(),
    }).not("id", "is", null),
    supabaseAdmin.from("players")
      .update({ in_active_draft: false })
      .eq("status", "approved"),
  ]);
  if (settingsErr) return { error: settingsErr.message };
  if (playersErr) return { error: playersErr.message };
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/draft");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function saveMatchSettings(deadlineDay: number, playDay: number, playHour: number) {
  await verifyAdmin();
  if (!Number.isInteger(deadlineDay) || deadlineDay < 0 || deadlineDay > 6)
    return { ok: false, message: "Invalid deadline day — must be 0–6." };
  if (!Number.isInteger(playDay) || playDay < 0 || playDay > 6)
    return { ok: false, message: "Invalid play day — must be 0–6." };
  if (!Number.isInteger(playHour) || playHour < 0 || playHour > 23)
    return { ok: false, message: "Invalid play hour — must be 0–23." };
  await supabaseAdmin.from("league_settings").update({
    match_deadline_day: deadlineDay,
    match_play_day: playDay,
    match_play_hour: playHour,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);
  revalidatePath("/dashboard/admin");
  return { ok: true, message: "Match schedule settings saved." };
}

const ADMIN_NOTIFICATION_CATEGORIES = ["match_reporting", "sub_requests", "registrations", "profile_changes", "schedule_approvals"];

export async function setAdminNotificationPref(category: string, enabled: boolean) {
  await verifyAdmin();
  if (!ADMIN_NOTIFICATION_CATEGORIES.includes(category))
    return { ok: false, message: "Invalid category." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("admin_notification_prefs").maybeSingle();
  const prefs = (settings?.admin_notification_prefs as Record<string, boolean> | null) ?? {};
  prefs[category] = enabled;

  await supabaseAdmin
    .from("league_settings")
    .update({ admin_notification_prefs: prefs, updated_at: new Date().toISOString() })
    .not("id", "is", null);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Removes all team-related Discord roles from every real player. Fetches each
// member's current roles first so it only deletes roles they actually have
// (avoids hundreds of no-op calls that trip Discord's rate limiter). Sequential
// + removeRoleById's 429 backoff keeps it under the limit.
async function stripTeamRolesFromPlayers(): Promise<{
  ok: number;
  removed: number;
  byStatus: Map<number, { count: number; message?: string }>;
  players: number;
}> {
  const byStatus = new Map<number, { count: number; message?: string }>();

  const { data: allDbPlayers } = await supabaseAdmin
    .from("players").select("discord_id").not("discord_id", "is", null);
  const realDiscordIds = (allDbPlayers ?? [])
    .map(p => p.discord_id as string)
    .filter(id => id && !id.startsWith("test_"));
  if (realDiscordIds.length === 0) return { ok: 0, removed: 0, byStatus, players: 0 };

  const { data: allTeams } = await supabaseAdmin.from("teams").select("name, discord_role_id");
  const guildRoles = await getGuildRoles();
  const teamNames = new Set(
    (allTeams ?? []).map(t => (t.name as string | null) ?? "").filter(Boolean)
  );
  const roleIds = new Set<string>([
    ...guildRoles.filter(r => r.name === "Drafted" || r.name === "Captain" || r.name === "EnteredDraft").map(r => r.id),
    ...(allTeams ?? []).map(t => t.discord_role_id).filter((id): id is string => !!id),
    ...guildRoles.filter(r => teamNames.has(r.name) || /^Team \d+$/.test(r.name)).map(r => r.id),
  ]);
  if (roleIds.size === 0) return { ok: 0, removed: 0, byStatus, players: realDiscordIds.length };

  let ok = 0;
  for (const uid of realDiscordIds) {
    const have = await getMemberRoleIds(uid);
    if (!have) continue; // not in the guild / fetch failed — nothing to remove
    for (const rid of have.filter(id => roleIds.has(id))) {
      const r = await removeRoleById(uid, rid);
      if (r.ok) { ok++; continue; }
      const entry = byStatus.get(r.status) ?? { count: 0, message: r.message };
      entry.count++;
      if (!entry.message && r.message) entry.message = r.message;
      byStatus.set(r.status, entry);
    }
  }
  return { ok, removed: ok, byStatus, players: realDiscordIds.length };
}

// Testing helper: strip team roles without touching season/draft state.
export async function stripTeamDiscordRoles(): Promise<{ ok?: boolean; error?: string; message?: string }> {
  await verifyAdmin();
  const { ok, byStatus, players } = await stripTeamRolesFromPlayers();
  const failed = [...byStatus.values()].reduce((s, e) => s + e.count, 0);
  if (failed > 0) {
    const reasons = [...byStatus.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([status, e]) => `${e.count}× ${status}${e.message ? ` ${e.message}` : ""}`)
      .join(", ");
    return { ok: false, message: `${failed} removal(s) failed (${ok} ok). Reasons: ${reasons}` };
  }
  return { ok: true, message: `Removed ${ok} role(s) across ${players} player(s) — all succeeded.` };
}

export async function saveMinMmr(min2v2: number | null, min3v3: number | null) {
  await verifyAdmin();
  // 0 / null / empty → no minimum. Otherwise must be a whole number 1–3000.
  const norm = (v: number | null): number | null | undefined => {
    if (v === null || Number.isNaN(v) || v === 0) return null;
    if (!Number.isInteger(v) || v < 0 || v > 3000) return undefined;
    return v;
  };
  const a = norm(min2v2);
  const b = norm(min3v3);
  if (a === undefined || b === undefined)
    return { ok: false, message: "Minimum MMR must be a whole number between 0 and 3000." };

  await supabaseAdmin.from("league_settings").update({
    min_mmr_2v2: a,
    min_mmr_3v3: b,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  revalidatePath("/dashboard/admin");
  return { ok: true, message: "Minimum MMR saved." };
}

export async function adminSetNumTeams(count: string) {
  await verifyAdmin();

  const { count: enteredCount } = await supabaseAdmin
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("status", "approved")
    .eq("draft_entered", true);
  const entered = enteredCount ?? 0;

  let numTeams: number;
  if (count.toLowerCase() === "max") {
    numTeams = Math.floor(entered / 3);
    if (numTeams < 1)
      return { error: `Need at least 3 players in the draft pool to create teams (currently ${entered}).` };
  } else {
    numTeams = parseInt(count);
    if (isNaN(numTeams) || numTeams < 1) return { error: "Enter a valid number or 'max'." };
    const required = numTeams * 3;
    if (entered < required)
      return { error: `${numTeams} teams requires ${required} players in the draft pool (currently ${entered}).` };
  }

  await supabaseAdmin.from("league_settings")
    .update({ num_teams: numTeams, updated_at: new Date().toISOString() }).not("id", "is", null);

  return { ok: true, message: `Teams set to ${numTeams}.` };
}

export async function setTestingMode(enabled: boolean) {
  await verifyAdmin();
  const cookieStore = await cookies();
  if (enabled) {
    cookieStore.set("testing_mode", "1", { httpOnly: true, path: "/", sameSite: "lax" });
  } else {
    cookieStore.delete("testing_mode");
  }
}

export async function setNotificationsEnabled(enabled: boolean) {
  await verifyAdmin();
  const cookieStore = await cookies();
  if (enabled) {
    cookieStore.delete("notifications_disabled");
  } else {
    cookieStore.set("notifications_disabled", "1", { httpOnly: true, path: "/", sameSite: "lax" });
  }
}

export async function setIsTestSeason(value: boolean) {
  await verifyAdmin();
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_active").single();
  if (settings?.season_active && !value) {
    // Prevent turning OFF test mode once a real (non-test) season is active.
    // (Turning it ON while active is also blocked by the UI, but guard here too.)
    return { error: "Cannot change test mode while a season is active." };
  }
  if (settings?.season_active && value) {
    return { error: "Cannot change test mode while a season is active." };
  }
  await supabaseAdmin
    .from("league_settings")
    .update({ is_test_season: value, updated_at: new Date().toISOString() })
    .not("id", "is", null);
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
