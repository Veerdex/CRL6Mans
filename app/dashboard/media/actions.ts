"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { classifyClipUrl, isLinkOnlyPlatform, type ClipPlatform } from "@/app/lib/clip-embed";
import { fetchClipThumbnail } from "@/app/lib/link-preview";
import { computeClipExpiry } from "@/app/lib/clip-schedule";

const MAX_ACTIVE_SUBMISSIONS_PER_PLAYER = 5;
const MAX_TITLE_LENGTH = 150;

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

  const trimmedTitle = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!trimmedTitle) return { error: "Title is required." };

  const classified = classifyClipUrl(url);
  if (!classified) return { error: "Link must be a valid YouTube, medal.tv, Streamable, Twitch, TikTok, X/Twitter, or Instagram URL." };

  const { count } = await supabaseAdmin
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .is("archived_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_SUBMISSIONS_PER_PLAYER) {
    return { error: `You can only have ${MAX_ACTIVE_SUBMISSIONS_PER_PLAYER} active submissions at a time.` };
  }

  const thumbnailUrl = isLinkOnlyPlatform(classified.platform)
    ? await fetchClipThumbnail(classified.platform, classified.normalizedUrl)
    : null;

  const { error } = await supabaseAdmin.from("clips").insert({
    player_id: playerId,
    title: trimmedTitle,
    url: classified.normalizedUrl,
    normalized_url: classified.normalizedUrl,
    platform: classified.platform,
    embed_url: classified.embedUrl,
    thumbnail_url: thumbnailUrl,
    expires_at: computeClipExpiry(new Date()).toISOString(),
  });
  if (error) {
    if (error.code === "23505") return { error: "This clip has already been submitted this week." };
    return { error: error.message };
  }

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

  revalidatePath("/dashboard/media");
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
