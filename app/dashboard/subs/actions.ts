"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

function peakMmr(p: { peak_2v2: string; peak_3v3: string }) {
  return Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0);
}

export async function submitSubRequest(
  teamId: string,
  matchId: string | null,
  playerOutId: string,
  subPlayerId: string | null,
  reason: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const admin = isAdmin(session.userId);

  if (!admin) {
    const { data: requestingPlayer } = await supabaseAdmin
      .from("players")
      .select("team_id, is_captain")
      .eq("discord_id", session.userId)
      .single();

    if (!requestingPlayer || requestingPlayer.team_id !== teamId) {
      return { error: "You are not on this team." };
    }
    if (!requestingPlayer.is_captain) {
      return { error: "Only captains can request substitutions." };
    }
  }

  const { data: playerOut } = await supabaseAdmin
    .from("players")
    .select("id, team_id, peak_2v2, peak_3v3")
    .eq("id", playerOutId)
    .single();

  if (!playerOut || playerOut.team_id !== teamId) {
    return { error: "Player being replaced is not on your team." };
  }

  if (subPlayerId) {
    const { data: subPlayer } = await supabaseAdmin
      .from("players")
      .select("id, peak_2v2, peak_3v3, team_id, status")
      .eq("id", subPlayerId)
      .single();

    if (!subPlayer) return { error: "Sub player not found." };
    if (subPlayer.status !== "approved") return { error: "Sub player is not an approved player." };
    if (subPlayer.team_id !== null) return { error: "Sub player is already on a team and cannot sub." };

    const outMmr = peakMmr(playerOut);
    const subMmr = peakMmr(subPlayer);
    if (subMmr > outMmr) {
      return {
        error: `Sub's MMR (${subMmr.toLocaleString()}) exceeds the replaced player's MMR (${outMmr.toLocaleString()}).`,
      };
    }
  }

  const { error } = await supabaseAdmin.from("sub_requests").insert({
    team_id: teamId,
    match_id: matchId || null,
    player_out_id: playerOutId,
    sub_player_id: subPlayerId || null,
    reason: reason || null,
    status: "pending",
    requested_by_discord_id: session.userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("sub_requests insert error:", error);
    return { error: "Failed to submit request. Please try again." };
  }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function approveSubRequest(
  requestId: string,
  adminNote?: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "approved", admin_note: adminNote || null, updated_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) return { error: "Failed to approve request." };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

export async function rejectSubRequest(
  requestId: string,
  adminNote?: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "rejected", admin_note: adminNote || null, updated_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) return { error: "Failed to reject request." };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

export async function cancelSubRequest(
  requestId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const { data: request } = await supabaseAdmin
    .from("sub_requests")
    .select("id, team_id, status")
    .eq("id", requestId)
    .single();

  if (!request) return { error: "Request not found." };
  if (request.status !== "pending") return { error: "Only pending requests can be cancelled." };

  if (!isAdmin(session.userId)) {
    const { data: player } = await supabaseAdmin
      .from("players")
      .select("team_id, is_captain")
      .eq("discord_id", session.userId)
      .single();

    if (!player || player.team_id !== request.team_id || !player.is_captain) {
      return { error: "You cannot cancel this request." };
    }
  }

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .delete()
    .eq("id", requestId);

  if (error) return { error: "Failed to cancel request." };

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
