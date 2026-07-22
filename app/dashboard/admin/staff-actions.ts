"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector, isCEO, isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { addRoleById, removeRoleById } from "@/app/lib/discord-api";
import { getStaffRoleIdMap } from "@/app/lib/discord-bot";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

const STAFF_TIERS = ["moderator", "director", "ceo"] as const;
type StaffTier = (typeof STAFF_TIERS)[number];
type StaffRoleIdMap = Record<StaffTier, string | null>;

function rolesUpTo(tier: StaffTier): StaffTier[] {
  return STAFF_TIERS.slice(0, STAFF_TIERS.indexOf(tier) + 1);
}

// Staff Discord roles are cumulative (a Director also holds Moderator, a CEO
// holds all three) to match isModerator()/isDirector() treating higher tiers
// as including lower ones — e.g. so a @Moderator escalation ping still reaches
// Directors and the CEO.
async function grantTierRoles(discordId: string, tier: StaffTier, roleIds: StaffRoleIdMap) {
  for (const t of rolesUpTo(tier)) {
    if (roleIds[t]) await addRoleById(discordId, roleIds[t]!);
  }
}

async function revokeTierRoles(discordId: string, tier: StaffTier, roleIds: StaffRoleIdMap) {
  for (const t of rolesUpTo(tier)) {
    if (roleIds[t]) await removeRoleById(discordId, roleIds[t]!);
  }
}

export type StaffMember = {
  discord_id: string;
  role: "moderator" | "director" | "ceo";
  username: string | null;
  added_by: string | null;
  created_at: string;
};

export async function getStaffList(): Promise<StaffMember[]> {
  const session = await getSession();
  if (!session?.userId || !(await isModerator(session.userId))) return [];
  const { data } = await supabaseAdmin
    .from("staff_roles")
    .select("discord_id, role, username, added_by, created_at")
    .order("created_at", { ascending: true });
  return (data ?? []) as StaffMember[];
}

export async function addStaffMember(
  discordId: string,
  username: string,
  role: "moderator" | "director"
): Promise<{ ok?: boolean; error?: string }> {
  if (role !== "moderator" && role !== "director") return { error: "Invalid role." };

  const session = await getSession();
  if (!session?.userId) redirect("/login");

  if (role === "moderator" && !(await isDirector(session.userId)))
    return { error: "Only Directors can add Moderators." };
  if (role === "director" && !(await isCEO(session.userId)))
    return { error: "Only the CEO can add Directors." };

  const id = discordId.trim();
  if (!/^\d{17,20}$/.test(id)) return { error: "Invalid Discord ID." };
  const name = username.trim();
  if (!name) return { error: "Username is required." };

  const { data: existing } = await supabaseAdmin
    .from("staff_roles")
    .select("role")
    .eq("discord_id", id)
    .single();
  if (existing) return { error: "This user already has a staff role." };

  const { error } = await supabaseAdmin.from("staff_roles").insert({
    discord_id: id,
    role,
    username: name,
    added_by: session.userId,
  });
  if (error) return { error: error.message };

  const roleIds = await getStaffRoleIdMap();
  await grantTierRoles(id, role, roleIds);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function removeStaffMember(
  discordId: string,
  role: "moderator" | "director"
): Promise<{ ok?: boolean; error?: string }> {
  if (role !== "moderator" && role !== "director") return { error: "Invalid role." };

  const session = await getSession();
  if (!session?.userId) redirect("/login");

  if (role === "moderator" && !(await isDirector(session.userId)))
    return { error: "Only Directors can remove Moderators." };
  if (role === "director" && !(await isCEO(session.userId)))
    return { error: "Only the CEO can remove Directors." };

  if (discordId === session.userId)
    return { error: "You cannot remove yourself." };

  const { error } = await supabaseAdmin
    .from("staff_roles")
    .delete()
    .eq("discord_id", discordId)
    .eq("role", role);
  if (error) return { error: error.message };

  const roleIds = await getStaffRoleIdMap();
  await revokeTierRoles(discordId, role, roleIds);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function transferCEO(
  newDiscordId: string,
  newUsername: string,
  confirmCode: string
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isCEO(session.userId))) return { error: "Only the CEO can transfer this role." };
  if (confirmCode !== "TRANSFER CEO") return { error: 'Type exactly: TRANSFER CEO' };

  const id = newDiscordId.trim();
  if (!/^\d{17,20}$/.test(id)) return { error: "Invalid Discord ID." };
  if (id === session.userId) return { error: "You are already the CEO." };

  const { data: existing } = await supabaseAdmin
    .from("staff_roles")
    .select("role")
    .eq("discord_id", id)
    .single();

  if (existing?.role === "ceo") return { error: "That user is already the CEO." };

  const roleIds = await getStaffRoleIdMap();

  // Promote new CEO first — if this fails the current CEO is unchanged.
  // Cumulative tiers mean promotion only ever adds roles, never removes any.
  if (existing) {
    const { error } = await supabaseAdmin.from("staff_roles").update({ role: "ceo" }).eq("discord_id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabaseAdmin.from("staff_roles").insert({
      discord_id: id,
      role: "ceo",
      username: newUsername.trim() || null,
      added_by: session.userId,
    });
    if (error) return { error: error.message };
  }
  await grantTierRoles(id, "ceo", roleIds);

  // Downgrade current CEO to Director only after new CEO is confirmed.
  await supabaseAdmin.from("staff_roles").update({ role: "director" }).eq("discord_id", session.userId);
  await grantTierRoles(session.userId, "director", roleIds); // self-heals moderator/director if missing
  if (roleIds.ceo) await removeRoleById(session.userId, roleIds.ceo);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}
