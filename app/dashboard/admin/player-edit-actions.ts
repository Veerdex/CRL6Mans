"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { applyPlayerRVChangeToTeamRating } from "@/app/lib/discord-bot";

async function assertAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
}

export async function approvePlayerEditRequest(
  requestId: string
): Promise<{ error?: string; ok?: boolean }> {
  await assertAdmin();

  const { data: req } = await supabaseAdmin
    .from("player_edit_requests")
    .select("player_id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, peak_1v1, current_1v1")
    .eq("id", requestId)
    .eq("status", "pending")
    .single();

  if (!req) return { error: "Request not found or already resolved." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
    .eq("id", req.player_id)
    .single();

  const now = new Date().toISOString();

  // Mirrored onto pending_players (Tier 2, source of truth for MMR going
  // forward) — see player-actions.ts's dual-write pattern.
  const { error: pendingErr } = await supabaseAdmin
    .from("pending_players")
    .update({
      tracker_url: req.tracker_url,
      peak_3v3:    req.peak_3v3,
      current_3v3: req.current_3v3,
      peak_2v2:    req.peak_2v2,
      current_2v2: req.current_2v2,
      peak_1v1:    req.peak_1v1 || null,
      current_1v1: req.current_1v1 || null,
      updated_at:  now,
    })
    .eq("account_id", req.player_id);

  if (pendingErr) return { error: pendingErr.message };

  const { error: updateErr } = await supabaseAdmin
    .from("players")
    .update({
      tracker_url: req.tracker_url,
      peak_3v3:    req.peak_3v3,
      current_3v3: req.current_3v3,
      peak_2v2:    req.peak_2v2,
      current_2v2: req.current_2v2,
      peak_1v1:    req.peak_1v1 || null,
      current_1v1: req.current_1v1 || null,
      tracker_confirmed_at: now,
      must_update_tracker: false,
      updated_at:  now,
    })
    .eq("id", req.player_id);

  if (updateErr) return { error: updateErr.message };

  if (player?.team_id) {
    await applyPlayerRVChangeToTeamRating(
      req.player_id,
      player.team_id,
      {
        peak_2v2:    player.peak_2v2,
        current_2v2: player.current_2v2,
        peak_3v3:    player.peak_3v3,
        current_3v3: player.current_3v3,
        peak_1v1:    player.peak_1v1,
        current_1v1: player.current_1v1,
      },
      {
        peak_2v2:    req.peak_2v2,
        current_2v2: req.current_2v2,
        peak_3v3:    req.peak_3v3,
        current_3v3: req.current_3v3,
        peak_1v1:    req.peak_1v1,
        current_1v1: req.current_1v1,
      },
    ).catch(() => {});
  }

  await supabaseAdmin
    .from("player_edit_requests")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", requestId);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function rejectPlayerEditRequest(
  requestId: string,
  adminNote: string
): Promise<{ error?: string; ok?: boolean }> {
  await assertAdmin();

  const { error } = await supabaseAdmin
    .from("player_edit_requests")
    .update({
      status:     "rejected",
      admin_note: adminNote.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
