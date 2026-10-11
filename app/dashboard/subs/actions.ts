"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getGuildRoles } from "@/app/lib/discord-api";
import {
  teamPing,
  subAdminApprovedPost,
  subCancelledPost,
} from "@/app/lib/match-embeds";
import { pushToTeam } from "@/app/lib/push";
// The flows the Discord bot shares live in app/lib/sub-requests.ts, since
// "use server" here would turn any helper this file exported into a server
// action. The actions below are the web half: session, redirect, revalidate.
import {
  postToChannel,
  getMatchTeams,
  teamName,
  submitSubRequestCore,
  acceptSubRequestCore,
  rejectSubRequestByOpponentCore,
  escalateSubRequestCore,
} from "@/app/lib/sub-requests";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

// ── Submit (requesting team) ─────────────────────────────────────────────────
export async function submitSubRequest(
  teamId: string,
  playerOutId: string,
  subPlayerId: string,
  reason: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const result = await submitSubRequestCore({
    actorDiscordId: session.userId,
    teamId,
    playerOutId,
    subPlayerId,
    reason,
    staffOverride: await isModeratorVerified(session.userId),
  });
  if (result.ok) revalidatePath("/dashboard/my-team");
  return result;
}

// ── Opposing team accepts ────────────────────────────────────────────────────
export async function acceptSubRequest(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const result = await acceptSubRequestCore({
    requestId,
    actorDiscordId: session.userId,
    staffOverride: await isModeratorVerified(session.userId),
  });
  if (result.ok) revalidatePath("/dashboard/my-team");
  return result;
}

// ── Opposing team rejects ────────────────────────────────────────────────────
export async function rejectSubRequestByOpponent(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const result = await rejectSubRequestByOpponentCore({
    requestId,
    actorDiscordId: session.userId,
    staffOverride: await isModeratorVerified(session.userId),
  });
  if (result.ok) revalidatePath("/dashboard/my-team");
  return result;
}

// ── Requesting team escalates a rejection to staff ───────────────────────────
export async function escalateSubRequest(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const result = await escalateSubRequestCore({
    requestId,
    actorDiscordId: session.userId,
    staffOverride: await isModeratorVerified(session.userId),
  });
  if (result.ok) {
    revalidatePath("/dashboard/my-team");
    revalidatePath("/dashboard/admin");
  }
  return result;
}

// ── Admin approves an escalated request ──────────────────────────────────────
export async function adminApproveSubRequest(
  requestId: string,
  adminNote?: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");

  const { data: req } = await supabaseAdmin
    .from("sub_requests")
    .select("id, team_id, match_id, player_out_id, sub_player_id, status")
    .eq("id", requestId)
    .single();
  if (!req) return { error: "Request not found." };

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "approved", admin_note: adminNote || null, updated_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { error: "Failed to approve request." };

  try {
    const match = await getMatchTeams(req.match_id);
    if (match?.discord_channel_id) {
      const myName = await teamName(req.team_id);
      const { data: pOut } = await supabaseAdmin.from("players").select("username").eq("id", req.player_out_id).single();
      await postToChannel(match.discord_channel_id, subAdminApprovedPost({
        teamName: myName ?? "a team",
        playerOut: pOut?.username ?? "a player",
      }));
    }
  } catch { /* best-effort */ }

  pushToTeam(req.team_id, {
    title: "Sub Request Approved",
    body: "Staff approved your substitute after review.",
    url: "/dashboard/my-team",
    tag: "sub-request",
  }).catch(() => {});

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

// ── Cancel / withdraw (requesting team or staff) ─────────────────────────────
// Hard-deletes the request so the team can submit a different one. Used for the
// requesting team's "cancel" / "request a different sub", and admin "decline".
export async function cancelSubRequest(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const { data: request } = await supabaseAdmin
    .from("sub_requests")
    .select("id, team_id, match_id, player_out_id, status")
    .eq("id", requestId)
    .single();

  if (!request) return { error: "Request not found." };

  const admin = await isModeratorVerified(session.userId);
  if (!admin) {
    const { data: player } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", session.userId).single();
    if (!player || player.team_id !== request.team_id) {
      return { error: "You cannot cancel this request." };
    }
  }

  const wasApproved = request.status === "approved";

  const { error } = await supabaseAdmin.from("sub_requests").delete().eq("id", requestId);
  if (error) return { error: "Failed to cancel request." };

  if (wasApproved && request.match_id) {
    try {
      const match = await getMatchTeams(request.match_id);
      if (match?.discord_channel_id) {
        const [myName, { data: pOut }, roles] = await Promise.all([
          teamName(request.team_id),
          supabaseAdmin.from("players").select("username").eq("id", request.player_out_id).single(),
          getGuildRoles(),
        ]);
        const opposingId = match.home_team_id === request.team_id ? match.away_team_id : match.home_team_id;
        const oppName = await teamName(opposingId);
        await postToChannel(match.discord_channel_id, subCancelledPost({
          teamName: myName ?? "a team",
          playerOut: pOut?.username ?? "the original player",
          oppPing: oppName ? teamPing(oppName, roles) : null,
        }));
      }
    } catch { /* best-effort */ }
  }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
