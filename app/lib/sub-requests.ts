// The sub-request flows the Discord bot shares with the website.
//
// They used to live only in app/dashboard/subs/actions.ts, which carries
// "use server" at the top — and that makes every export in the file a server
// action, so a plain helper cannot be exported from it and a caller cannot pass
// its own identity in: the actions read the session cookie, which the bot has
// no access to. Each core here takes `actorDiscordId` instead, and the cookie
// read, `redirect("/login")` and `revalidatePath` stay in the thin wrappers
// there.
//
// `staffOverride` is passed in rather than decided here on purpose. On the
// website it is isModeratorVerified(), which is gated on Discord 2FA being on;
// the bot has no equivalent proof, so it passes false and typing a command in
// Discord never grants a staff bypass.

import { supabaseAdmin } from "./supabase";
import { sendChannelMessage, getGuildRoles } from "./discord-api";
import {
  teamPing,
  rolePing,
  subRequestedPost,
  subAcceptedPost,
  subRejectedPost,
  subEscalatedPost,
  type ChannelPost,
} from "./match-embeds";
import { pushToAdmins, pushToTeam } from "./push";
import { playerRatingFromRow } from "./rating";

export type SubRequestResult = { ok?: boolean; error?: string };

const peakMmr = playerRatingFromRow;

// A sub notification always goes to a match channel the caller already resolved,
// so these post through sendChannelMessage rather than notifyMatchChannel.
export async function postToChannel(channelId: string, post: ChannelPost): Promise<void> {
  await sendChannelMessage(channelId, post.content, post.embeds, post.allowed_mentions);
}

// Match row with both teams + channel, used for routing/notifications.
export async function getMatchTeams(matchId: string | null) {
  if (!matchId) return null;
  const { data } = await supabaseAdmin
    .from("matches")
    .select("discord_channel_id, home_team_id, away_team_id")
    .eq("id", matchId)
    .maybeSingle();
  return data as { discord_channel_id: string | null; home_team_id: string | null; away_team_id: string | null } | null;
}

export async function teamName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin.from("teams").select("name").eq("id", id).single();
  return data?.name ?? null;
}

// ── Submit (requesting team) ─────────────────────────────────────────────────
// One sub per request, one active request per team. No admin review — the
// opposing team accepts or rejects.
export async function submitSubRequestCore(args: {
  actorDiscordId: string;
  teamId: string;
  playerOutId: string;
  subPlayerId: string;
  reason: string;
  staffOverride: boolean;
}): Promise<SubRequestResult> {
  const { actorDiscordId, teamId, playerOutId, subPlayerId, reason, staffOverride } = args;

  if (!staffOverride) {
    const { data: requestingPlayer } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", actorDiscordId).single();
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
    .select("id, username, team_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
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
    supabaseAdmin.from("league_settings").select("active_tournament_id, subs_enabled").single(),
  ]);

  const nextMatch = (nextMatchRows ?? [])[0] ?? null;
  const activeTournamentId = (leagueSettings?.active_tournament_id as string | null) ?? null;
  if (leagueSettings?.subs_enabled === false) {
    return { error: "Substitute requests are currently disabled by staff." };
  }

  if (activeTournamentId) {
    const { data: tourney } = await supabaseAdmin
      .from("tournaments").select("join_mode").eq("id", activeTournamentId).single();
    if (tourney?.join_mode === "teams") {
      return { error: "Substitute requests are not available for team sign-up tournaments." };
    }
  }

  if (!nextMatch) return { error: "Your team has no upcoming matches." };

  const opposingTeamId = nextMatch.home_team_id === teamId
    ? nextMatch.away_team_id
    : nextMatch.home_team_id;

  // Validate the single sub candidate.
  const { data: sub } = await supabaseAdmin
    .from("players")
    .select("id, username, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1, team_id, status, sub_willing, draft_entered")
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
  // These absolute thresholds were tuned against the old rating formula's output
  // scale (crl-game-share-elo-v1) and may need recalibration now that ratings are
  // produced by crl-final-rating-v1 (app/lib/rating.ts) — revisit once real numbers
  // are visible under the new formula.
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
    requested_by_discord_id: actorDiscordId,
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
      await postToChannel(match.discord_channel_id, subRequestedPost({
        teamName: myName ?? "A team",
        oppPing: oppName ? teamPing(oppName, roles) : null,
        playerOut,
        sub,
        reason,
      }));
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

  return { ok: true };
}

// Resolve the request and verify the caller is on the opposing team (or is staff).
async function loadRequestForOpponent(requestId: string, actorDiscordId: string, staffOverride: boolean) {
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

  if (!staffOverride) {
    const { data: caller } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", actorDiscordId).single();
    if (!caller || caller.team_id !== opposingTeamId) {
      return { error: "Only the opposing team can respond to this request." as const };
    }
  }
  return { request, match, opposingTeamId };
}

// ── Opposing team accepts ────────────────────────────────────────────────────
export async function acceptSubRequestCore(args: {
  requestId: string;
  actorDiscordId: string;
  staffOverride: boolean;
}): Promise<SubRequestResult> {
  const loaded = await loadRequestForOpponent(args.requestId, args.actorDiscordId, args.staffOverride);
  if ("error" in loaded) return { error: loaded.error };
  const { request, match } = loaded;

  if (request.status !== "pending") return { error: "This request is no longer awaiting your response." };

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", args.requestId);
  if (error) return { error: "Failed to accept request." };

  try {
    if (match?.discord_channel_id) {
      const myName = await teamName(request.team_id);
      const { data: pOut } = await supabaseAdmin.from("players").select("username").eq("id", request.player_out_id).single();
      await postToChannel(match.discord_channel_id, subAcceptedPost({
        teamName: myName ?? "a team",
        playerOut: pOut?.username ?? "a player",
      }));
    }
  } catch { /* best-effort */ }

  pushToTeam(request.team_id, {
    title: "Sub Request Accepted",
    body: "Your opponent accepted your substitute for the upcoming match.",
    url: "/dashboard/my-team",
    tag: "sub-request",
  }).catch(() => {});

  return { ok: true };
}

// ── Opposing team rejects ────────────────────────────────────────────────────
export async function rejectSubRequestByOpponentCore(args: {
  requestId: string;
  actorDiscordId: string;
  staffOverride: boolean;
}): Promise<SubRequestResult> {
  const loaded = await loadRequestForOpponent(args.requestId, args.actorDiscordId, args.staffOverride);
  if ("error" in loaded) return { error: loaded.error };
  const { request, match } = loaded;

  if (request.status !== "pending") return { error: "This request is no longer awaiting your response." };

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", args.requestId);
  if (error) return { error: "Failed to reject request." };

  try {
    if (match?.discord_channel_id) {
      const myName = await teamName(request.team_id);
      await postToChannel(match.discord_channel_id, subRejectedPost(myName ?? "a team"));
    }
  } catch { /* best-effort */ }

  pushToTeam(request.team_id, {
    title: "Sub Request Rejected",
    body: "Your opponent rejected your sub request. You can report it to staff or request a different sub.",
    url: "/dashboard/my-team",
    tag: "sub-request",
  }).catch(() => {});

  return { ok: true };
}

// ── Requesting team escalates a rejection to staff ───────────────────────────
//
// The mirror image of the two cores above: they are the opponent's to run, this
// one is the requesting team's. Not loadRequestForOpponent, therefore — the
// standing test is `caller.team_id === request.team_id`, the exact inverse of
// that helper's, and the same inversion decision-targets.ts documents.
export async function escalateSubRequestCore(args: {
  requestId: string;
  actorDiscordId: string;
  staffOverride: boolean;
}): Promise<SubRequestResult> {
  const { data: request } = await supabaseAdmin
    .from("sub_requests")
    .select("id, team_id, match_id, player_out_id, status")
    .eq("id", args.requestId)
    .single();
  if (!request) return { error: "Request not found." };
  if (request.status !== "rejected") return { error: "Only a rejected request can be reported to staff." };

  if (!args.staffOverride) {
    const { data: caller } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", args.actorDiscordId).single();
    if (!caller || caller.team_id !== request.team_id) return { error: "You cannot report this request." };
  }

  const { error } = await supabaseAdmin
    .from("sub_requests")
    .update({ status: "escalated", updated_at: new Date().toISOString() })
    .eq("id", args.requestId);
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
      // The by-name fallback is kept, unlike the team pings: "moderator" is a league-
      // owned role name, not a player-supplied one, so there's no @everyone hole here.
      const modPing = rolePing(modRoleId) ?? teamPing("moderator", await getGuildRoles());
      await postToChannel(match.discord_channel_id, subEscalatedPost({
        teamName: myName ?? "A team",
        modPing,
      }));
    }
  } catch { /* best-effort */ }

  return { ok: true };
}
