"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isLinkOnlyPlatform, type ClipPlatform } from "@/app/lib/clip-embed";
import { createClip, MAX_TITLE_LENGTH } from "@/app/lib/clip-submit";

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

// Staff manage anyone's clip; everyone else only their own. Checked against the
// row rather than trusting the caller — the is_own flag the feed sends down
// decides which buttons to draw, nothing more. Shared by delete and rename so
// the two can't drift; the verb only picks the wording.
async function clipPermissionError(
  discordId: string,
  clipId: string,
  verb: "delete" | "edit",
): Promise<string | null> {
  if (await isModerator(discordId)) return null;

  const playerId = await getApprovedPlayerId(discordId);
  if (!playerId) return `Only approved players can ${verb} clips.`;

  const { data: clip } = await supabaseAdmin
    .from("clips")
    .select("player_id")
    .eq("id", clipId)
    .maybeSingle();
  if (clip?.player_id !== playerId) return `You can only ${verb} your own clips.`;

  return null;
}

export async function deleteClip(clipId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  const denied = await clipPermissionError(session.userId, clipId, "delete");
  if (denied) return { error: denied };

  const { error } = await supabaseAdmin.from("clips").delete().eq("id", clipId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/media");
  return { ok: true };
}

// Title only. The URL is what dedup, the platform and the embed are all derived
// from, so changing it would mean re-running createClip's whole classification
// rather than an update.
export async function renameClip(clipId: string, title: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  const denied = await clipPermissionError(session.userId, clipId, "edit");
  if (denied) return { error: denied };

  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!trimmed) return { error: "Title is required." };

  const { error } = await supabaseAdmin.from("clips").update({ title: trimmed }).eq("id", clipId);
  if (error) return { error: error.message };

  // The crowned clip is rendered on the dashboard home as well as here, and a
  // moderator can rename one from either feed before it is crowned or after.
  revalidatePath("/dashboard/media");
  revalidatePath("/dashboard");
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
