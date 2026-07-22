"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { sendChannelMessage, getGuildRoles, type DiscordEmbed } from "@/app/lib/discord-api";
import { roleMention } from "@/app/lib/match-notifications";
import { pushToAdmins, pushToTeam } from "@/app/lib/push";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

type RankRow = {
  username: string;
  peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
};

function peakMmr(p: { peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }) {
  return (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2;
}

function rankField(label: string, p: RankRow): { name: string; value: string; inline: true } {
  const rv = Math.round(peakMmr(p));
  return {
    name: `${label}: ${p.username}`,
    value:
      `• All Time Peak 2v2: ${Number(p.peak_2v2).toLocaleString()}\n` +
      `• Season Peak 2v2: ${Number(p.current_2v2).toLocaleString()}\n` +
      `• All Time Peak 3v3: ${Number(p.peak_3v3).toLocaleString()}\n` +
      `• Season Peak 3v3: ${Number(p.current_3v3).toLocaleString()}\n` +
      `• Rank Value: ${rv.toLocaleString()}`,
    inline: true,
  };
}

// Match row with both teams + channel, used for routing/notifications.
async function getMatchTeams(matchId: string | null) {
  if (!matchId) return null;
  const { data } = await supabaseAdmin
    .from("matches")
    .select("discord_channel_id, home_team_id, away_team_id")
    .eq("id", matchId)
    .maybeSingle();
  return data as { discord_channel_id: string | null; home_team_id: string | null; away_team_id: string | null } | null;
}

async function teamName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin.from("teams").select("name").eq("id", id).single();
  return data?.name ?? null;
}

// ── Submit (requesting team) ─────────────────────────────────────────────────
// One sub per request, one active request per team. No admin review — the
// opposing team accepts or rejects.
export async function submitSubRequest(
  teamId: string,
  playerOutId: string,
  subPlayerId: string,
  reason: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const admin = await isModeratorVerified(session.userId);

  if (!admin) {
    const { data: requestingPlayer } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", session.userId).single();
    if (!requestingPlayer || requestingPlayer.team_id !== teamId) {
      return { error: "You are not on this team." };
    }
  }

  if (!subPlayerId) return { error: "Select a substitute." };

  // One active sub request per team at a time. Consumed requests are deleted when
  // the match is played, so any remaining row means a request is still in flight.
  const { data: activeReqs } = await supabaseAdmin
    .from("sub_requests")
    .select("id")
    .eq("team_id", teamId)
    .in("status", ["pending", "rejected", "escalated", "approved"])
    .limit(1);
  if ((activeReqs ?? []).length > 0) {
    return { error: "Your team already has an active sub request. Cancel it before requesting another." };
  }

  const { data: playerOut } = await supabaseAdmin
    .from("players")
    .select("id, username, team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("id", playerOutId)
    .single();

  if (!playerOut || playerOut.team_id !== teamId) {
    return { error: "Player being replaced is not on your team." };
  }

  const [{ data: nextMatchRows }, { data: leagueSettings }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, home_team_id, away_team_id")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .is("home_score", null)
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null)
      .order("round").order("match_number").limit(1),
    supabaseAdmin.from("league_settings").select("active_tournament_id").single(),
  ]);

  const nextMatch = (nextMatchRows ?? [])[0] ?? null;
  const activeTournamentId = (leagueSettings?.active_tournament_id as string | null) ?? null;
  if (!nextMatch) return { error: "Your team has no upcoming matches." };

  const opposingTeamId = nextMatch.home_team_id === teamId
    ? nextMatch.away_team_id
    : nextMatch.home_team_id;

  // Validate the single sub candidate.
  const { data: sub } = await supabaseAdmin
    .from("players")
    .select("id, username, peak_2v2, current_2v2, peak_3v3, current_3v3, team_id, status, sub_willing, draft_entered")
    .eq("id", subPlayerId)
    .single();

  if (!sub) return { error: "Selected sub player was not found." };
  if (sub.status !== "approved") return { error: `${sub.username} is not an approved player.` };
  if (!sub.sub_willing) return { error: `${sub.username} has not enabled substitute availability.` };
  if (sub.team_id === teamId) return { error: `${sub.username} is on your team.` };
  if (opposingTeamId && sub.team_id === opposingTeamId) return { error: `${sub.username} is on the opposing team.` };

  if (activeTournamentId) {
    const { data: entry } = await supabaseAdmin
      .from("tournament_entries")
      .select("player_id")
      .eq("tournament_id", activeTournamentId)
      .eq("player_id", sub.id)
      .maybeSingle();
    if (!entry && sub.team_id === null) return { error: `${sub.username} did not sign up for this tournament.` };
  } else if (!sub.draft_entered && sub.team_id === null) {
    return { error: `${sub.username} did not enter the draft.` };
  }

  // Sub eligibility depends on the player being replaced. If they're below 1400 rating,
  // subs can go up to +100 of that rating. Otherwise, subs must be <= player's rating.
  const playerOutMmr = peakMmr(playerOut);
  const subMmr = peakMmr(sub);
  const mmrLimit = playerOutMmr < 1400 ? playerOutMmr + 100 : playerOutMmr;
  if (subMmr > mmrLimit) {
    return {
      error: `${sub.username}'s Rank Value (${Math.round(subMmr).toLocaleString()}) is too high for this substitution. Maximum allowed: ${Math.round(mmrLimit).toLocaleString()}.`,
    };
  }

  const { error } = await supabaseAdmin.from("sub_requests").insert({
    team_id: teamId,
    match_id: nextMatch.id,
    player_out_id: playerOutId,
    sub_player_id: subPlayerId,
    sub_player_ids: null,
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

  // Notify the opposing team in the match channel with full rank detail.
  try {
    const match = await getMatchTeams(nextMatch.id);
    if (match?.discord_channel_id) {
      const [myName, oppName, roles] = await Promise.all([
        teamName(teamId),
        teamName(opposingTeamId),
        getGuildRoles(),
      ]);
      const oppMention = oppName ? await roleMention(oppName, roles) : "";
      const embed: DiscordEmbed = {
        color: 0xe88a24,
        fields: [rankField("Out", playerOut), rankField("Sub", sub)],
        ...(reason ? { description: `**Reason:** ${reason}` } : {}),
        footer: { text: "Head to the website to accept or reject this substitution." },
      };
      await sendChannelMessage(
        match.discord_channel_id,
        `${oppMention} ⚠️ **${myName ?? "A team"}** requested a substitution.`,
        [embed],
      );
    }
  } catch { /* best-effort */ }

  // Notify the opposing team's players so they know there's a request to act on.
  if (opposingTeamId) {
    const myName = await teamName(teamId);
    pushToTeam(opposingTeamId, {
      title: "Sub Request to Review",
      body: `${myName ?? "A team"} requested a substitute for your upcoming match. Accept or reject it on your team page.`,
      url: "/dashboard/my-team",
      tag: "sub-request",
    }).catch(() => {});
  }

  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

// Resolve the request and verify the caller is on the opposing team (or is staff).
async function loadRequestForOpponent(requestId: string) {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const { data: request } = await supabaseAdmin
    .from("sub_requests")
    .select("id, team_id, match_id, player_out_id, sub_player_id, status")
    .eq("id", requestId)
    .single();
  if (!request) return { error: "Request not found." as const };

  const match = await getMatchTeams(request.match_id);
  const opposingTeamId = match
    ? (match.home_team_id === request.team_id ? match.away_team_id : match.home_team_id)
    : null;

  if (!(await isModeratorVerified(session.userId))) {
    const { data: caller } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", session.userId).single();
    if (!caller || caller.team_id !== opposingTeamId) {
      return { error: "Only the opposing team can respond to this request." as const };
    }
  }
  return { request, match, opposingTeamId };
}

// ── Opposing team accepts ────────────────────────────────────────────────────
export async function acceptSubRequest(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const loaded = await loadRequestForOpponent(requestId);
  if ("error" in loaded) return { error: loaded.error };
  const { request, match } = loaded;

  if (request.status !== "pending") return { error: "This request is no longer awaiting your response." };

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { error: "Failed to accept request." };

  try {
    if (match?.discord_channel_id) {
      const myName = await teamName(request.team_id);
      const { data: pOut } = await supabaseAdmin.from("players").select("username").eq("id", request.player_out_id).single();
      await sendChannelMessage(
        match.discord_channel_id,
        `✅ The substitution for **${myName ?? "a team"}** (in place of **${pOut?.username ?? "a player"}**) was **accepted** by the opposing team.`,
      );
    }
  } catch { /* best-effort */ }

  pushToTeam(request.team_id, {
    title: "Sub Request Accepted",
    body: "Your opponent accepted your substitute for the upcoming match.",
    url: "/dashboard/my-team",
    tag: "sub-request",
  }).catch(() => {});

  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

// ── Opposing team rejects ────────────────────────────────────────────────────
export async function rejectSubRequestByOpponent(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const loaded = await loadRequestForOpponent(requestId);
  if ("error" in loaded) return { error: loaded.error };
  const { request, match } = loaded;

  if (request.status !== "pending") return { error: "This request is no longer awaiting your response." };

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { error: "Failed to reject request." };

  try {
    if (match?.discord_channel_id) {
      const myName = await teamName(request.team_id);
      await sendChannelMessage(
        match.discord_channel_id,
        `❌ The opposing team **rejected** the substitution requested by **${myName ?? "a team"}**.`,
      );
    }
  } catch { /* best-effort */ }

  pushToTeam(request.team_id, {
    title: "Sub Request Rejected",
    body: "Your opponent rejected your sub request. You can report it to staff or request a different sub.",
    url: "/dashboard/my-team",
    tag: "sub-request",
  }).catch(() => {});

  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

// ── Requesting team escalates a rejection to staff ───────────────────────────
export async function escalateSubRequest(requestId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const { data: request } = await supabaseAdmin
    .from("sub_requests")
    .select("id, team_id, match_id, player_out_id, status")
    .eq("id", requestId)
    .single();
  if (!request) return { error: "Request not found." };
  if (request.status !== "rejected") return { error: "Only a rejected request can be reported to staff." };

  if (!(await isModeratorVerified(session.userId))) {
    const { data: caller } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", session.userId).single();
    if (!caller || caller.team_id !== request.team_id) return { error: "You cannot report this request." };
  }

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "escalated", updated_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { error: "Failed to report request." };

  // Admins are pinged only at escalation.
  pushToAdmins({
    title: "Sub Request Escalated",
    body: "A team reported a rejected sub request for staff review.",
    url: "/dashboard/admin",
    tag: "sub-request",
  }, "sub_requests").catch(() => {});

  try {
    const match = await getMatchTeams(request.match_id);
    if (match?.discord_channel_id) {
      const myName = await teamName(request.team_id);
      const { data: ls } = await supabaseAdmin
        .from("league_settings").select("moderator_role_id").single();
      const modRoleId = ls?.moderator_role_id as string | null;
      const modMention = modRoleId
        ? `<@&${modRoleId}>`
        : await roleMention("moderator", await getGuildRoles());
      await sendChannelMessage(
        match.discord_channel_id,
        `${modMention} ⚖️ **${myName ?? "A team"}** has reported their rejected substitution for staff review.`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
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
      await sendChannelMessage(
        match.discord_channel_id,
        `✅ Staff **approved** the substitution for **${myName ?? "a team"}** in place of **${pOut?.username ?? "a player"}**.`,
      );
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
        const mention = oppName ? await roleMention(oppName, roles) : "";
        await sendChannelMessage(
          match.discord_channel_id,
          `${mention} ↩️ The substitution for **${myName ?? "a team"}** has been cancelled — **${pOut?.username ?? "the original player"}** will play as originally scheduled.`,
        );
      }
    } catch { /* best-effort */ }
  }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
