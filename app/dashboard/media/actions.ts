"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isLinkOnlyPlatform, type ClipPlatform } from "@/app/lib/clip-embed";
import { createClip } from "@/app/lib/clip-submit";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

async function getApprovedPlayerId(discordId: string): Promise<string | null> {
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status")
    .eq("discord_id", discordId)
    .single();
  if (!player || player.status !== "approved") return null;
  return player.id;
}

export async function submitClip(title: string, url: string, durationConfirmed: boolean, appropriateConfirmed: boolean): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  const playerId = await getApprovedPlayerId(session.userId);
  if (!playerId) return { error: "Only approved players can submit clips." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("clip_confirmations_enabled")
    .single();
  if (settings?.clip_confirmations_enabled ?? true) {
    if (!durationConfirmed) return { error: "You must confirm the clip is 60 seconds or shorter." };
    if (!appropriateConfirmed) return { error: "You must confirm the clip is appropriate for the league community." };
  }

  const { error } = await createClip(playerId, title, url);
  if (error) return { error };

  revalidatePath("/dashboard/media");
  return { ok: true };
}

export async function toggleClipLike(clipId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  const playerId = await getApprovedPlayerId(session.userId);
  if (!playerId) return { error: "Only approved players can like clips." };

  const { data: existing } = await supabaseAdmin
    .from("clip_likes")
    .select("clip_id")
    .eq("clip_id", clipId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from("clip_likes").delete().eq("clip_id", clipId).eq("player_id", playerId);
  } else {
    await supabaseAdmin.from("clip_likes").insert({ clip_id: clipId, player_id: playerId });
  }

  const { count } = await supabaseAdmin
    .from("clip_likes")
    .select("clip_id", { count: "exact", head: true })
    .eq("clip_id", clipId);
  await supabaseAdmin.from("clips").update({ likes_count: count ?? 0 }).eq("id", clipId);

  // The Clip of the Week card renders on the dashboard home too, so a like from
  // there has to invalidate both paths or the count on the other one goes stale.
  revalidatePath("/dashboard/media");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteClip(clipId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isModerator(session.userId))) return { error: "Only staff can delete clips." };

  const { error } = await supabaseAdmin.from("clips").delete().eq("id", clipId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/media");
  return { ok: true };
}

export async function setClipOfWeek(clipId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isModerator(session.userId))) return { error: "Only staff can set the Clip of the Week." };

  const { data: clip } = await supabaseAdmin
    .from("clips")
    .select("platform")
    .eq("id", clipId)
    .single();
  if (!clip) return { error: "Clip not found." };
  if (isLinkOnlyPlatform(clip.platform as ClipPlatform)) {
    return { error: "Only clips with an embeddable player can be Clip of the Week." };
  }

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ clip_of_week_id: clipId })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/media");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleClipConfirmations(): Promise<{ ok?: boolean; enabled?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isModerator(session.userId))) return { error: "Only staff can change this." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("clip_confirmations_enabled")
    .single();
  const next = !(settings?.clip_confirmations_enabled ?? true);

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ clip_confirmations_enabled: next })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/media");
  return { ok: true, enabled: next };
}

export async function clearClipOfWeek(): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isModerator(session.userId))) return { error: "Only staff can clear the Clip of the Week." };

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ clip_of_week_id: null })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/media");
  revalidatePath("/dashboard");
  return { ok: true };
}
