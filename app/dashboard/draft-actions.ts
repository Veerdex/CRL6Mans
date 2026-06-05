"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { execAutoPick } from "@/app/lib/discord-bot";

export async function triggerAutoPick(): Promise<void> {
  await execAutoPick();
}

export async function enterDraft(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, draft_entered")
    .eq("discord_id", session.userId)
    .single();

  if (!player) return { error: "You are not registered." };
  if (player.status !== "approved") return { error: "Your registration must be approved first." };
  if (player.draft_entered) return { error: "You are already in the draft." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("draft_open")
    .single();

  if (!settings?.draft_open) return { error: "Draft signups are not currently open." };

  await supabaseAdmin
    .from("players")
    .update({ draft_entered: true, updated_at: new Date().toISOString() })
    .eq("id", player.id);

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function leaveDraft(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/");

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("draft_active, season_active")
    .single();

  if (settings?.draft_active || settings?.season_active) {
    return { error: "You cannot leave the draft once the draft or season has started." };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, draft_entered")
    .eq("discord_id", session.userId)
    .single();

  if (!player) return { error: "You are not registered." };
  if (!player.draft_entered) return { error: "You are not in the draft." };

  await supabaseAdmin
    .from("players")
    .update({ draft_entered: false, updated_at: new Date().toISOString() })
    .eq("id", player.id);

  revalidatePath("/dashboard");
  return { ok: true };
}
