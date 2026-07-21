"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { editRole, addRole, addRoleById, removeRoleById, removeRole } from "@/app/lib/discord-api";
import { validateImageUpload } from "@/app/lib/uploads";

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
  const offsetX = Math.max(0, Math.min(100, parseInt(formData.get("offsetX") as string) || 50));
  const offsetY = Math.max(0, Math.min(100, parseInt(formData.get("offsetY") as string) || 50));
  const logoFile = formData.get("logo") as File | null;

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("is_locked, discord_role_id")
    .eq("id", teamId)
    .single();

  const userIsAdmin = await isModerator(session.userId);
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

export async function deleteTeam(teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModerator(session.userId))) return { error: "Not authorized." };

  // Only the last numbered team slot can be deleted — use the Team Slots panel in admin.
  const { data: teams } = await supabaseAdmin
    .from("teams").select("id, slot_number, discord_role_id").not("slot_number", "is", null);
  const numbered = (teams ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .sort((a, b) => b.slot_number - a.slot_number);

  const lastId = numbered[0]?.id;
  if (teamId !== lastId) return { error: "Only the last team slot can be deleted. Use the Team Slots panel." };

  const team = numbered[0];

  const { data: members } = await supabaseAdmin
    .from("players")
    .select("discord_id, is_captain")
    .eq("team_id", teamId);

  await supabaseAdmin.from("players")
    .update({ team_id: null, is_captain: false })
    .eq("team_id", teamId);

  const { error } = await supabaseAdmin.from("teams").delete().eq("id", teamId);
  if (error) return { error: error.message };

  for (const m of members ?? []) {
    if (!m.discord_id) continue;
    if (team?.discord_role_id) removeRoleById(m.discord_id, team.discord_role_id).catch(() => {});
    if (m.is_captain) removeRole(m.discord_id, "Captain").catch(() => {});
  }

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

async function assignCaptainIfMissing(teamId: string): Promise<void> {
  const { data: members } = await supabaseAdmin
    .from("players")
    .select("id, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3, is_captain")
    .eq("team_id", teamId);

  if (!members?.length || members.length <= 2) return;
  if (members.some((m) => m.is_captain)) return;

  const best = members.reduce((a, b) => {
    const aRv = (Number(a.peak_2v2) + Number(a.current_2v2)) * 0.3 + (Number(a.peak_3v3) + Number(a.current_3v3)) * 0.2;
    const bRv = (Number(b.peak_2v2) + Number(b.current_2v2)) * 0.3 + (Number(b.peak_3v3) + Number(b.current_3v3)) * 0.2;
    return aRv >= bRv ? a : b;
  });

  await supabaseAdmin.from("players").update({ is_captain: true }).eq("id", best.id);
  if (best.discord_id) addRole(best.discord_id, "Captain").catch(() => {});
}

export async function removePlayerFromTeam(playerId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModerator(session.userId))) return { error: "Not authorized." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("discord_id, team_id, is_captain")
    .eq("id", playerId)
    .single();

  const { error } = await supabaseAdmin.from("players")
    .update({ team_id: null, is_captain: false })
    .eq("id", playerId);
  if (error) return { error: error.message };

  if (player?.discord_id && player.team_id) {
    const { data: team } = await supabaseAdmin
      .from("teams").select("discord_role_id").eq("id", player.team_id).single();
    if (team?.discord_role_id)
      await removeRoleById(player.discord_id, team.discord_role_id);
    if (player.is_captain)
      await removeRole(player.discord_id, "Captain");
  }

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function movePlayerToTeam(playerId: string, newTeamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModerator(session.userId))) return { error: "Not authorized." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("discord_id, team_id, is_captain")
    .eq("id", playerId)
    .single();

  const { error } = await supabaseAdmin.from("players")
    .update({ team_id: newTeamId, is_captain: false })
    .eq("id", playerId);
  if (error) return { error: error.message };

  if (player?.discord_id) {
    const [{ data: oldTeam }, { data: newTeam }] = await Promise.all([
      player.team_id
        ? supabaseAdmin.from("teams").select("discord_role_id").eq("id", player.team_id).single()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("teams").select("discord_role_id").eq("id", newTeamId).single(),
    ]);
    if (oldTeam?.discord_role_id)
      await removeRoleById(player.discord_id, oldTeam.discord_role_id);
    if (player.is_captain)
      await removeRole(player.discord_id, "Captain");
    if (newTeam?.discord_role_id)
      await addRoleById(player.discord_id, newTeam.discord_role_id);
  }

  await assignCaptainIfMissing(newTeamId);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function addPlayerToTeam(playerId: string, teamId: string) {
  // Delegates to movePlayerToTeam which handles Discord roles and captain assignment.
  return movePlayerToTeam(playerId, teamId);
}

export async function toggleTeamLock(teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModerator(session.userId))) return { error: "Not authorized." };

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
