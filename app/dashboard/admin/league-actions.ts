"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { execStartDraft, execEndDraft, execStartSeason, deleteMatchChannels, execSyncRoles } from "@/app/lib/discord-bot";
import { editRole, getGuildRoles, removeRoleById } from "@/app/lib/discord-api";

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

  const numTeams = Math.min(sortedTeams.length, Math.floor(players.length / 3));
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
    num_teams: numTeams,
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
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");
  return session;
}

export async function adminStartDraft(code: string) {
  await verifyAdmin();
  if (code !== "CONFIRM DRAFT") return { error: 'Type exactly: CONFIRM DRAFT' };
  const result = await execStartDraft();
  if (result.ok) {
    revalidatePath("/dashboard/teams");
    revalidatePath("/dashboard/draft");
  }
  return result;
}

export async function adminEndDraft(code: string) {
  await verifyAdmin();
  if (code !== "END DRAFT") return { error: 'Type exactly: END DRAFT' };
  const result = await execEndDraft();
  if (result.ok) revalidatePath("/dashboard/teams");
  return result;
}

export async function adminStartSeason(code: string) {
  await verifyAdmin();
  if (code !== "START SEASON") return { error: 'Type exactly: START SEASON' };
  const result = await execStartSeason();
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
  return { ok: true, message: "Draft signups closed." };
}

export async function resetSeason() {
  await verifyAdmin();

  // Delete Discord match channels before wiping the DB
  await deleteMatchChannels();

  // Delete matches and reset team stats — team slots (name, discord_role_id) are preserved
  await supabaseAdmin.from("matches").delete().not("id", "is", null);
  await supabaseAdmin.from("teams").update({ wins: 0, losses: 0, is_locked: false }).not("id", "is", null);

  // Reset all player assignments and draft entries
  await supabaseAdmin
    .from("players")
    .update({ team_id: null, is_captain: false, draft_entered: false, draft_entered_at: null, in_active_draft: false })
    .not("id", "is", null);

  // Strip Discord roles (Drafted, Captain, all team roles) from real players
  const { data: allApprovedPlayers } = await supabaseAdmin
    .from("players").select("discord_id").eq("status", "approved").not("discord_id", "is", null);
  const realDiscordIds = (allApprovedPlayers ?? [])
    .map(p => p.discord_id as string)
    .filter(id => id && !id.startsWith("test_"));
  if (realDiscordIds.length > 0) {
    const { data: allTeams } = await supabaseAdmin.from("teams").select("discord_role_id");
    const guildRoles = await getGuildRoles();
    const roleIdsToStrip = [
      ...guildRoles.filter(r => r.name === "Drafted" || r.name === "Captain" || r.name === "EnteredDraft").map(r => r.id),
      ...(allTeams ?? []).map(t => t.discord_role_id).filter((id): id is string => !!id),
    ];
    if (roleIdsToStrip.length > 0) {
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

  // Reset ALL draft/season state so nothing looks active or in-progress
  await supabaseAdmin.from("league_settings").update({
    draft_open: false,
    draft_active: false,
    season_active: false,
    num_teams: 0,
    current_pick: 0,
    draft_phase: null,
    nominated_player_id: null,
    current_bid: null,
    current_bid_team_id: null,
    current_bid_time: null,
    pick_deadline: null,
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/players");
  return { ok: true, message: "Season reset. Players unassigned, draft cleared." };
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
    .select("id, name, discord_role_id")
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
  return { ok: true, team: newTeam as { id: string; name: string; discord_role_id: string | null } };
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
