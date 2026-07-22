"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt, invalidatePlayerSessions } from "@/app/lib/session";
import { getStaffRole, isModerator, removeRegisteredRole, type StaffRole } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { addRole, removeRole, removeRoleById, timeoutMember, banMember, unbanMember } from "@/app/lib/discord-api";

async function getActorRole(): Promise<StaffRole> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/dashboard");
  const role = await getStaffRole(session.userId);
  if (!role) redirect("/dashboard");
  return role;
}

async function assertModerator() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModerator(session.userId))) redirect("/dashboard");
}

function canActOn(actorRole: StaffRole, targetRole: StaffRole | null): boolean {
  if (actorRole === "ceo") return true;
  if (actorRole === "director") return targetRole !== "director" && targetRole !== "ceo";
  return targetRole === null; // moderator can only act on non-staff
}

async function removeFromActivePlay(playerId: string) {
  await supabaseAdmin.from("players").update({
    team_id: null,
    is_captain: false,
    draft_entered: false,
    in_active_draft: false,
    updated_at: new Date().toISOString(),
  }).eq("id", playerId);

  const { data: activeTournaments } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .in("status", ["scheduled", "active"]);
  if (activeTournaments?.length) {
    await supabaseAdmin
      .from("tournament_entries")
      .delete()
      .eq("player_id", playerId)
      .in("tournament_id", activeTournaments.map((t) => t.id));
  }
}

export async function kickPlayer(
  playerId: string,
  reason: string,
  timeoutMs: number = 7 * 24 * 60 * 60 * 1000,
  kickedUntil: Date | null = null
): Promise<{ ok?: boolean; error?: string }> {
  const actorRole = await getActorRole();

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("discord_id, team_id")
    .eq("id", playerId)
    .single();

  const targetRole = player?.discord_id ? await getStaffRole(player.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: "You don't have permission to moderate this user." };

  await removeFromActivePlay(playerId);
  await supabaseAdmin
    .from("players")
    .update({
      kick_reason: reason.trim() || null,
      kicked_until: kickedUntil ? kickedUntil.toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", playerId);

  if (player?.discord_id && !player.discord_id.startsWith("test_")) {
    const { discord_id, team_id } = player;
    const roleRemovals: Promise<unknown>[] = [removeRole(discord_id, "Captain")];
    if (team_id) {
      const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", team_id).single();
      if (team?.discord_role_id) roleRemovals.push(removeRoleById(discord_id, team.discord_role_id));
    }
    await Promise.all(roleRemovals);
    await addRole(discord_id, "Kicked");
    await timeoutMember(discord_id, timeoutMs);
    await invalidatePlayerSessions(discord_id);
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}

export type RejectionCooldown = "5m" | "1d" | "forever";

// Reused by rejectPlatformAccount for the optional cooldown on a rejected
// platform-account claim. "forever" reuses kickPlayer's default (permanent
// kick_reason, no kicked_until, standard Discord timeout) — same broad kick
// as the moderation panel. "5m"/"1d" set kicked_until to match, and size the
// Discord timeout to the same window so the two don't disagree.
export async function kickForRejectionCooldown(
  playerId: string,
  reason: string,
  cooldown: RejectionCooldown
): Promise<{ ok?: boolean; error?: string }> {
  if (cooldown === "forever") return kickPlayer(playerId, reason);
  const ms = cooldown === "5m" ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return kickPlayer(playerId, reason, ms, new Date(Date.now() + ms));
}

export async function banPlayer(
  playerId: string,
  reason: string
): Promise<{ ok?: boolean; error?: string }> {
  const actorRole = await getActorRole();

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("discord_id, team_id")
    .eq("id", playerId)
    .single();

  const targetRole = player?.discord_id ? await getStaffRole(player.discord_id) : null;
  if (!canActOn(actorRole, targetRole)) return { error: "You don't have permission to moderate this user." };

  await removeFromActivePlay(playerId);
  const { error } = await supabaseAdmin
    .from("players")
    .update({
      status: "banned",
      ban_reason: reason.trim() || null,
      kick_reason: null,
      kicked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", playerId);
  if (error) return { error: error.message };

  if (player?.discord_id && !player.discord_id.startsWith("test_")) {
    const { discord_id, team_id } = player;
    const roleRemovals: Promise<unknown>[] = [
      removeRegisteredRole(discord_id),
      removeRole(discord_id, "Captain"),
      removeRole(discord_id, "Kicked"),
    ];
    if (team_id) {
      const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", team_id).single();
      if (team?.discord_role_id) roleRemovals.push(removeRoleById(discord_id, team.discord_role_id));
    }
    await Promise.all(roleRemovals);
    await banMember(discord_id); // server ban — removes them from the guild
    await invalidatePlayerSessions(discord_id);
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}

export async function unbanPlayer(
  playerId: string
): Promise<{ ok?: boolean; error?: string }> {
  await assertModerator();

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("discord_id")
    .eq("id", playerId)
    .single();

  // Wipe their profile data — they must re-register from scratch when they rejoin
  const { error } = await supabaseAdmin
    .from("players")
    .update({
      status: "unregistered",
      ban_reason: null,
      kick_reason: null,
      kicked_until: null,
      peak_3v3: "0",
      current_3v3: "0",
      peak_2v2: "0",
      current_2v2: "0",
      tracker_url: "",
      college_image_url: "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", playerId);
  if (error) return { error: error.message };

  if (player?.discord_id && !player.discord_id.startsWith("test_")) {
    await unbanMember(player.discord_id); // lift Discord server ban so they can rejoin
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/players");
  return { ok: true };
}
