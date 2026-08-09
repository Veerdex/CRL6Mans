"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { editRole, addRole, addRoleById, removeRoleById, removeRole } from "@/app/lib/discord-api";
import { validateImageUpload } from "@/app/lib/uploads";
import { applyPlayerRVChangeToTeamRating, execDisqualifyTeam } from "@/app/lib/discord-bot";
import { playerRatingFromRow } from "@/app/lib/rating";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export async function updateTeamInfo(formData: FormData) {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const teamId = formData.get("teamId") as string;
  const name = (formData.get("name") as string)?.trim();
  if (name && name.length > 30) return { error: "Team name must be 30 characters or fewer." };
  if (name && /@everyone|@here|<@/i.test(name)) return { error: "Team name cannot contain Discord mentions." };
  if (name && !/^[a-zA-Z0-9 ]+$/.test(name)) return { error: "Team name can only contain letters, numbers, and spaces." };
  const offsetX = Math.max(0, Math.min(100, parseInt(formData.get("offsetX") as string) || 50));
  const offsetY = Math.max(0, Math.min(100, parseInt(formData.get("offsetY") as string) || 50));
  const logoFile = formData.get("logo") as File | null;

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("is_locked, discord_role_id")
    .eq("id", teamId)
    .single();

  const userIsAdmin = await isModeratorVerified(session.userId);
  if (team?.is_locked && !userIsAdmin) return { error: "Team info is locked by an admin." };

  if (!userIsAdmin) {
    const { data: player } = await supabaseAdmin
      .from("players")
      .select("team_id")
      .eq("discord_id", session.userId)
      .eq("status", "approved")
      .single();
    if (player?.team_id !== teamId) return { error: "You are not on this team." };
  }

  const updates: Record<string, unknown> = {
    logo_offset_x: offsetX,
    logo_offset_y: offsetY,
  };

  if (name) updates.name = name;

  if (logoFile && logoFile.size > 0) {
    const validated = await validateImageUpload(logoFile);
    if ("error" in validated) return { error: validated.error };

    const fileName = `${teamId}-${Date.now()}.${validated.ext}`;

    // Ensure the bucket exists; ignore "already exists" to handle race conditions
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.find((b) => b.name === "team-logos")) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket("team-logos", { public: true });
      if (bucketError && !bucketError.message.toLowerCase().includes("already exists")) {
        return { error: "Could not initialize storage. Please try again." };
      }
    }

    const { error: uploadError } = await supabaseAdmin.storage
      .from("team-logos")
      .upload(fileName, validated.bytes, { contentType: validated.contentType, upsert: true });

    if (uploadError) return { error: "Logo upload failed. Please try again." };

    const { data: urlData } = supabaseAdmin.storage.from("team-logos").getPublicUrl(fileName);
    updates.logo_url = urlData.publicUrl;
  }

  const { error } = await supabaseAdmin.from("teams").update(updates).eq("id", teamId);
  if (error) return { error: "Failed to save changes. Please try again." };

  if (name && team?.discord_role_id) {
    await editRole(team.discord_role_id, { name });
  }

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

async function assignCaptainIfMissing(teamId: string): Promise<void> {
  const { data: members } = await supabaseAdmin
    .from("players")
    .select("id, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1, is_captain")
    .eq("team_id", teamId);

  if (!members?.length || members.length <= 2) return;
  if (members.some((m) => m.is_captain)) return;

  const ratingOf = playerRatingFromRow;
  const best = members.reduce((a, b) => (ratingOf(a) >= ratingOf(b) ? a : b));

  await supabaseAdmin.from("players").update({ is_captain: true }).eq("id", best.id);
  if (best.discord_id) addRole(best.discord_id, "Captain").catch(() => {});
}

type PlayerRow = {
  id: string;
  discord_id: string | null;
  team_id: string | null;
  is_captain: boolean | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
  peak_1v1: string | null;
  current_1v1: string | null;
};

const PLAYER_RV_SELECT = "id, discord_id, team_id, is_captain, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1";

export async function swapPlayersBetweenTeams(playerAId: string, playerBId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };
  if (playerAId === playerBId) return { error: "Cannot swap a player with themself." };

  const [{ data: playerA }, { data: playerB }] = await Promise.all([
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", playerAId).single(),
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", playerBId).single(),
  ]);
  if (!playerA?.team_id || !playerB?.team_id) return { error: "Both players must be on a team to swap." };
  if (playerA.team_id === playerB.team_id) return { error: "Players are already on the same team." };

  const a = playerA as PlayerRow;
  const b = playerB as PlayerRow;
  const teamAId = a.team_id as string;
  const teamBId = b.team_id as string;
  const rvFields = (p: PlayerRow) => ({
    peak_2v2: p.peak_2v2, current_2v2: p.current_2v2, peak_3v3: p.peak_3v3, current_3v3: p.current_3v3,
    peak_1v1: p.peak_1v1, current_1v1: p.current_1v1,
  });

  await Promise.all([
    applyPlayerRVChangeToTeamRating(a.id, teamAId, rvFields(a), rvFields(b)).catch(() => {}),
    applyPlayerRVChangeToTeamRating(b.id, teamBId, rvFields(b), rvFields(a)).catch(() => {}),
  ]);

  const [{ error: errA }, { error: errB }] = await Promise.all([
    supabaseAdmin.from("players").update({ team_id: teamBId, is_captain: false }).eq("id", a.id),
    supabaseAdmin.from("players").update({ team_id: teamAId, is_captain: false }).eq("id", b.id),
  ]);
  if (errA || errB) return { error: "Failed to swap players. Please try again." };

  const [{ data: teamA }, { data: teamB }] = await Promise.all([
    supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamAId).single(),
    supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamBId).single(),
  ]);

  if (a.discord_id) {
    if (teamAId && teamA?.discord_role_id) removeRoleById(a.discord_id, teamA.discord_role_id).catch(() => {});
    if (a.is_captain) removeRole(a.discord_id, "Captain").catch(() => {});
    if (teamB?.discord_role_id) addRoleById(a.discord_id, teamB.discord_role_id).catch(() => {});
  }
  if (b.discord_id) {
    if (teamBId && teamB?.discord_role_id) removeRoleById(b.discord_id, teamB.discord_role_id).catch(() => {});
    if (b.is_captain) removeRole(b.discord_id, "Captain").catch(() => {});
    if (teamA?.discord_role_id) addRoleById(b.discord_id, teamA.discord_role_id).catch(() => {});
  }

  await Promise.all([assignCaptainIfMissing(teamAId), assignCaptainIfMissing(teamBId)]);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function swapRosterPlayerWithBenchPlayer(rosterPlayerId: string, benchPlayerId: string, teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };
  if (rosterPlayerId === benchPlayerId) return { error: "Cannot swap a player with themself." };

  const [{ data: rosterPlayer }, { data: benchPlayer }] = await Promise.all([
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", rosterPlayerId).single(),
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", benchPlayerId).single(),
  ]);
  if (rosterPlayer?.team_id !== teamId) return { error: "Player is not on this team." };
  if (benchPlayer?.team_id !== null) return { error: "That player is already on a team." };

  const roster = rosterPlayer as PlayerRow;
  const bench = benchPlayer as PlayerRow;
  const rvFields = (p: PlayerRow) => ({
    peak_2v2: p.peak_2v2, current_2v2: p.current_2v2, peak_3v3: p.peak_3v3, current_3v3: p.current_3v3,
    peak_1v1: p.peak_1v1, current_1v1: p.current_1v1,
  });

  await applyPlayerRVChangeToTeamRating(roster.id, teamId, rvFields(roster), rvFields(bench)).catch(() => {});

  const [{ error: errOut }, { error: errIn }] = await Promise.all([
    supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).eq("id", roster.id),
    supabaseAdmin.from("players").update({ team_id: teamId, is_captain: false }).eq("id", bench.id),
  ]);
  if (errOut || errIn) return { error: "Failed to swap players. Please try again." };

  const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamId).single();

  if (roster.discord_id) {
    if (team?.discord_role_id) removeRoleById(roster.discord_id, team.discord_role_id).catch(() => {});
    if (roster.is_captain) removeRole(roster.discord_id, "Captain").catch(() => {});
  }
  if (bench.discord_id && team?.discord_role_id) addRoleById(bench.discord_id, team.discord_role_id).catch(() => {});

  await assignCaptainIfMissing(teamId);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function disqualifyTeam(teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const result = await execDisqualifyTeam(teamId);
  if (!result.ok) return { error: result.message };

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/season");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function toggleTeamLock(teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("is_locked")
    .eq("id", teamId)
    .single();

  await supabaseAdmin
    .from("teams")
    .update({ is_locked: !team?.is_locked })
    .eq("id", teamId);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}
