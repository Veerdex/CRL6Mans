"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector, isCEO } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export type StaffMember = {
  discord_id: string;
  role: "moderator" | "director" | "ceo";
  username: string | null;
  added_by: string | null;
  created_at: string;
};

export async function getStaffList(): Promise<StaffMember[]> {
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

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function removeStaffMember(
  discordId: string,
  role: "moderator" | "director"
): Promise<{ ok?: boolean; error?: string }> {
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

  // Promote new CEO first — if this fails the current CEO is unchanged.
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

  // Downgrade current CEO to Director only after new CEO is confirmed.
  await supabaseAdmin.from("staff_roles").update({ role: "director" }).eq("discord_id", session.userId);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}
