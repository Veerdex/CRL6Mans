"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isModerator } from "@/app/lib/players";
import { hasActiveVerifiedPlatformAccount, joinGateApplies } from "@/app/lib/platform-account-gate";
import { normalizeTeamSize } from "@/app/lib/team-size";
import { playerRatingFromRow } from "@/app/lib/rating";
import { hasMmrOnFile, MMR_REQUIRED_MESSAGE } from "@/app/lib/mmr-on-file";
import { pushToUser } from "@/app/lib/push";
import {
  hasEarlySignupAccess,
  playerHasEarlySignupAccess,
  signupWindowOpen,
  type SignupWindowRow,
} from "@/app/lib/signup-window";

// A roster is the tournament's team size plus one substitute, so both move with
// it: a 3v3 still allows 4, a 2v2 allows 3, a 1v1 allows 2.
const rosterMax = (teamSize: number) => teamSize + 1;

// The window is carried raw rather than collapsed into a single
// registrationOpen boolean because Early Signup Access is not always the
// acting player's: a supporter who creates a team opens the early window for
// everyone they invite, so each action resolves it from whoever governs it.
type Ctx = {
  playerId: string;
  playerName: string;
  discordId: string;
  tournamentId: string;
  tournamentName: string;
  teamSize: number;
  statsEnabled: boolean;
  mmrOnFile: boolean;
  window: SignupWindowRow;
};

/** Resolve the current approved player against a specific team-signup tournament. */
async function getContext(tournamentId: string): Promise<{ ctx?: Ctx; error?: string }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, username, display_name, peak_2v2, peak_3v3")
    .eq("discord_id", session.userId)
    .single();
  if (!player) return { error: "No player profile found." };
  if (player.status !== "approved") return { error: "Only approved players can join tournaments." };

  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("name, join_mode, signups_open, signups_closed, status, draft_open_at, draft_close_at, team_size, stats_enabled, is_test")
    .eq("id", tournamentId)
    .single();
  if (!t || (t.is_test && !(await isModerator(session.userId)))) return { error: "Tournament not found." };
  if (t.join_mode !== "teams") return { error: "This tournament does not use team sign-ups." };

  return {
    ctx: {
      playerId: player.id,
      playerName: player.display_name ?? player.username ?? "A player",
      discordId: session.userId,
      tournamentId,
      tournamentName: (t.name as string | null) ?? "a tournament",
      teamSize: normalizeTeamSize((t as { team_size?: number }).team_size),
      statsEnabled: (t as { stats_enabled?: boolean | null }).stats_enabled ?? true,
      mmrOnFile: hasMmrOnFile(player as { peak_2v2?: string; peak_3v3?: string }),
      window: t as SignupWindowRow,
    },
  };
}

/** The team the player is currently part of (created or accepted) in this tournament. */
async function findMyTeam(playerId: string, tournamentId: string) {
  const { data: signups } = await supabaseAdmin
    .from("team_signups")
    .select("id, creator_player_id, name, team_signup_members(player_id, status)")
    .eq("tournament_id", tournamentId);

  return (signups ?? []).find((s) =>
    (s.team_signup_members as { player_id: string; status: string }[]).some(
      (m) => m.player_id === playerId && m.status === "accepted"
    )
  ) ?? null;
}

/** Resolve the signup a member row belongs to (for member-scoped actions). */
async function signupForMember(
  memberId: string
): Promise<{ tournamentId: string; creatorPlayerId: string } | null> {
  const { data: member } = await supabaseAdmin
    .from("team_signup_members").select("team_signup_id").eq("id", memberId).single();
  if (!member) return null;
  const { data: ts } = await supabaseAdmin
    .from("team_signups").select("tournament_id, creator_player_id").eq("id", member.team_signup_id).single();
  if (!ts) return null;
  return { tournamentId: ts.tournament_id as string, creatorPlayerId: ts.creator_player_id as string };
}

// Shared by createTeam and renameTeam so a rename can't slip a name past the
// rules the create form enforces.
function teamNameError(trimmed: string): string | null {
  if (!trimmed) return "Team name is required.";
  if (trimmed.length > 30) return "Team name is too long (30 char max).";
  if (!/^[a-zA-Z0-9 ]+$/.test(trimmed))
    return "Team name can only contain letters, numbers, and spaces.";
  return null;
}

/** `exceptId` is what lets a team change its own name's casing. */
async function nameTaken(tournamentId: string, trimmed: string, exceptId?: string) {
  let q = supabaseAdmin
    .from("team_signups")
    .select("id")
    .eq("tournament_id", tournamentId)
    .ilike("name", trimmed);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.maybeSingle();
  return !!data;
}

// Captaincy belongs to the highest-RV player, so a captain leaving hands the
// team to whoever activation would have made captain anyway. Ties break on who
// accepted first.
async function heirToCaptaincy(signupId: string) {
  const { data: members } = await supabaseAdmin
    .from("team_signup_members")
    .select("player_id, responded_at")
    .eq("team_signup_id", signupId)
    .eq("status", "accepted");
  if (!members?.length) return null;

  const { data: rows } = await supabaseAdmin
    .from("players")
    .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .in(
      "id",
      members.map((m) => m.player_id)
    );
  const byId = new Map((rows ?? []).map((p) => [p.id as string, p]));

  return members
    .map((m) => {
      const p = byId.get(m.player_id as string);
      return {
        playerId: m.player_id as string,
        name: (p?.display_name as string | null) ?? (p?.username as string | undefined) ?? "a teammate",
        rating: p ? playerRatingFromRow(p) : 0,
        respondedAt: (m.responded_at as string | null) ?? "",
      };
    })
    .sort((a, b) => b.rating - a.rating || a.respondedAt.localeCompare(b.respondedAt))[0];
}

// Asked on every join, with no freshness window — see joinTournament. The flag
// is what ties the stamp to a player who actually looked at the numbers, so the
// write belongs on the confirmed pass of each action rather than beside the
// popup that collects them.
type SignupResult = { error?: string; ok?: boolean; message?: string; confirmMmr?: boolean };

async function markTrackerConfirmed(playerId: string) {
  await supabaseAdmin
    .from("players")
    .update({ tracker_confirmed_at: new Date().toISOString(), must_update_tracker: false })
    .eq("id", playerId);
}

async function checkJoinGate(playerId: string, statsEnabled: boolean): Promise<string | null> {
  if (!(await joinGateApplies(statsEnabled))) return null;
  if (await hasActiveVerifiedPlatformAccount(playerId, new Date())) return null;
  return "You need a verified platform account before joining a team. Add one in Settings → Platform Accounts.";
}

function refresh() {
  revalidatePath("/dashboard");
}

// The Join button's pre-flight. Everything createTeam can refuse without a name
// in hand, run in createTeam's own order, so the claimed-account requirement is
// answered before the MMR popup rather than after the team is named — which is
// the order joinTournament has always used for player mode. createTeam keeps
// every one of these gates; this only moves where a player meets them, so a
// window that shuts between the two calls is still caught.
export async function beginTeamSignup(tournamentId: string): Promise<SignupResult> {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };
  if (!signupWindowOpen(ctx.window, await hasEarlySignupAccess(ctx.discordId)))
    return { error: "Team registration is closed." };

  if (await findMyTeam(ctx.playerId, ctx.tournamentId)) return { error: "You're already on a team." };

  const gateError = await checkJoinGate(ctx.playerId, ctx.statsEnabled);
  if (gateError) return { error: gateError };

  return { ok: true };
}

export async function createTeam(
  tournamentId: string,
  name: string,
  confirmedMmr = false,
): Promise<SignupResult> {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };
  if (!signupWindowOpen(ctx.window, await hasEarlySignupAccess(ctx.discordId)))
    return { error: "Team registration is closed." };

  const trimmed = name.trim();
  const nameError = teamNameError(trimmed);
  if (nameError) return { error: nameError };

  const existing = await findMyTeam(ctx.playerId, ctx.tournamentId);
  if (existing) return { error: "You're already on a team." };

  const gateError = await checkJoinGate(ctx.playerId, ctx.statsEnabled);
  if (gateError) return { error: gateError };

  if (await nameTaken(ctx.tournamentId, trimmed))
    return { error: "A team with that name already exists." };

  // The Join button opens the popup before the name form, so this is the
  // backstop for any other caller rather than the path a player takes.
  if (!confirmedMmr) return { confirmMmr: true };
  if (!ctx.mmrOnFile) return { error: MMR_REQUIRED_MESSAGE };
  await markTrackerConfirmed(ctx.playerId);

  const { data: team, error: insErr } = await supabaseAdmin
    .from("team_signups")
    .insert({ tournament_id: ctx.tournamentId, creator_player_id: ctx.playerId, name: trimmed })
    .select("id")
    .single();
  if (insErr || !team) return { error: insErr?.message ?? "Failed to create team." };

  await supabaseAdmin.from("team_signup_members").insert({
    team_signup_id: team.id,
    player_id: ctx.playerId,
    status: "accepted",
    responded_at: new Date().toISOString(),
  });

  // In a 1v1 the creator alone is already a full roster, and respondInvite —
  // the only other place formed_at gets set — never runs for a solo team.
  if (ctx.teamSize <= 1)
    await supabaseAdmin
      .from("team_signups")
      .update({ formed_at: new Date().toISOString() })
      .eq("id", team.id);

  const invites = rosterMax(ctx.teamSize) - 1;
  refresh();
  return {
    ok: true,
    message: `Team "${trimmed}" created. Invite up to ${invites} player${invites === 1 ? "" : "s"}.`,
  };
}

export async function invitePlayer(tournamentId: string, targetPlayerId: string) {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };
  if (!signupWindowOpen(ctx.window, await hasEarlySignupAccess(ctx.discordId)))
    return { error: "Team registration is closed." };

  const { data: team } = await supabaseAdmin
    .from("team_signups")
    .select("id, name, team_signup_members(player_id, status)")
    .eq("tournament_id", ctx.tournamentId)
    .eq("creator_player_id", ctx.playerId)
    .maybeSingle();
  if (!team) return { error: "Only a team's creator can invite players." };
  if (targetPlayerId === ctx.playerId) return { error: "You're already on the team." };

  const members = team.team_signup_members as { player_id: string; status: string }[];
  const max = rosterMax(ctx.teamSize);
  if (members.length >= max)
    return { error: `Roster is full (max ${max} including pending invites).` };
  if (members.some((m) => m.player_id === targetPlayerId))
    return { error: "That player is already invited or on the team." };

  const { data: target } = await supabaseAdmin
    .from("players").select("id, status, discord_id").eq("id", targetPlayerId).single();
  if (!target || target.status !== "approved") return { error: "That player isn't approved." };

  const targetTeam = await findMyTeam(targetPlayerId, ctx.tournamentId);
  if (targetTeam) return { error: "That player is already on a team." };

  const { error: insErr } = await supabaseAdmin.from("team_signup_members").insert({
    team_signup_id: team.id,
    player_id: targetPlayerId,
    status: "invited",
  });
  if (insErr) return { error: insErr.message };

  // Unconditional: an invite the player never sees is an invite that expires.
  // The card only shows it to someone without a team, and a Discord DM isn't on
  // offer here, so this notice is the only thing that reaches them.
  if (target.discord_id)
    pushToUser(target.discord_id as string, {
      title: "Team Invite",
      body: `${ctx.playerName} invited you to join ${team.name} for ${ctx.tournamentName}.`,
      url: "/dashboard",
      tag: "team-invite",
      category: "tournament",
    }).catch(() => {});

  refresh();
  return { ok: true, message: "Invite sent." };
}

export async function renameTeam(tournamentId: string, name: string) {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };
  // Gated on the window because the name is copied into `teams` and the
  // Discord role at activation — a rename after that wouldn't follow it.
  if (!signupWindowOpen(ctx.window, await hasEarlySignupAccess(ctx.discordId)))
    return { error: "Team registration is closed." };

  const trimmed = name.trim();
  const nameError = teamNameError(trimmed);
  if (nameError) return { error: nameError };

  const { data: team } = await supabaseAdmin
    .from("team_signups")
    .select("id, name")
    .eq("tournament_id", ctx.tournamentId)
    .eq("creator_player_id", ctx.playerId)
    .maybeSingle();
  if (!team) return { error: "Only a team's captain can rename it." };
  if (team.name === trimmed) return { ok: true, message: "Team name unchanged." };

  if (await nameTaken(ctx.tournamentId, trimmed, team.id))
    return { error: "A team with that name already exists." };

  const { error: updErr } = await supabaseAdmin
    .from("team_signups")
    .update({ name: trimmed })
    .eq("id", team.id);
  if (updErr) return { error: updErr.message };

  refresh();
  return { ok: true, message: `Team renamed to "${trimmed}".` };
}

export async function revokeInvite(memberId: string) {
  const signup = await signupForMember(memberId);
  if (!signup) return { error: "Invite not found." };
  const { ctx, error } = await getContext(signup.tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };

  const { data: member } = await supabaseAdmin
    .from("team_signup_members")
    .select("id, status")
    .eq("id", memberId)
    .single();
  if (!member) return { error: "Invite not found." };
  if (signup.creatorPlayerId !== ctx.playerId) return { error: "Not allowed." };
  if (member.status !== "invited") return { error: "That player already accepted." };

  await supabaseAdmin.from("team_signup_members").delete().eq("id", memberId);
  refresh();
  return { ok: true, message: "Invite revoked." };
}

export async function respondInvite(
  memberId: string,
  accept: boolean,
  confirmedMmr = false,
): Promise<SignupResult> {
  const signup = await signupForMember(memberId);
  if (!signup) return { error: "Invite not found." };
  const { ctx, error } = await getContext(signup.tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };

  const { data: member } = await supabaseAdmin
    .from("team_signup_members")
    .select("id, player_id, status, team_signup_id")
    .eq("id", memberId)
    .single();
  if (!member || member.player_id !== ctx.playerId) return { error: "Invite not found." };
  if (member.status !== "invited") return { error: "Invite already handled." };

  if (!accept) {
    await supabaseAdmin.from("team_signup_members").delete().eq("id", memberId);
    refresh();
    return { ok: true, message: "Invite declined." };
  }

  // Deliberately the creator's entitlement rather than the responder's: the
  // invitee is usually not a patron, and the point of the benefit is that the
  // supporter's whole team signs up early with them.
  if (!signupWindowOpen(ctx.window, await playerHasEarlySignupAccess(signup.creatorPlayerId)))
    return { error: "Team registration is closed." };

  const existing = await findMyTeam(ctx.playerId, ctx.tournamentId);
  if (existing) return { error: "You're already on a team." };

  const gateError = await checkJoinGate(ctx.playerId, ctx.statsEnabled);
  if (gateError) return { error: gateError };

  // Last gate before the write, so a closed window, already being on a team,
  // or a missing platform account is refused without first making the player
  // confirm MMR for an invite they can't take.
  if (!confirmedMmr) return { confirmMmr: true };
  if (!ctx.mmrOnFile) return { error: MMR_REQUIRED_MESSAGE };
  await markTrackerConfirmed(ctx.playerId);

  await supabaseAdmin
    .from("team_signup_members")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", memberId);

  // Remove this player's other pending invites (in this tournament)
  const { data: tournamentSignups } = await supabaseAdmin
    .from("team_signups").select("id").eq("tournament_id", ctx.tournamentId);
  const ids = (tournamentSignups ?? []).map((s) => s.id);
  if (ids.length)
    await supabaseAdmin
      .from("team_signup_members")
      .delete()
      .eq("player_id", ctx.playerId)
      .eq("status", "invited")
      .in("team_signup_id", ids);

  // Mark the team "formed" once it reaches the minimum roster
  const { count } = await supabaseAdmin
    .from("team_signup_members")
    .select("*", { count: "exact", head: true })
    .eq("team_signup_id", member.team_signup_id)
    .eq("status", "accepted");
  if ((count ?? 0) >= ctx.teamSize) {
    const { data: tsRow } = await supabaseAdmin
      .from("team_signups").select("formed_at").eq("id", member.team_signup_id).single();
    if (!tsRow?.formed_at)
      await supabaseAdmin
        .from("team_signups")
        .update({ formed_at: new Date().toISOString() })
        .eq("id", member.team_signup_id);
  }

  refresh();
  return { ok: true, message: "You joined the team!" };
}

export async function leaveTeam(tournamentId: string) {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };

  const team = await findMyTeam(ctx.playerId, ctx.tournamentId);
  if (!team) return { error: "You're not on a team." };

  await supabaseAdmin
    .from("team_signup_members")
    .delete()
    .eq("team_signup_id", team.id)
    .eq("player_id", ctx.playerId);

  let handover = "";
  if (team.creator_player_id === ctx.playerId) {
    const heir = await heirToCaptaincy(team.id);
    // Nobody accepted but the captain, so there is no team to hand over —
    // deleting it cascades the pending invites away, as disbandTeam does. An
    // invitee is never promoted into a team they haven't joined.
    if (!heir) {
      await supabaseAdmin.from("team_signups").delete().eq("id", team.id);
      refresh();
      return { ok: true, message: "You left, and the team was disbanded." };
    }
    await supabaseAdmin
      .from("team_signups")
      .update({ creator_player_id: heir.playerId })
      .eq("id", team.id);
    handover = ` ${heir.name} is now captain.`;
  }

  const { count } = await supabaseAdmin
    .from("team_signup_members")
    .select("*", { count: "exact", head: true })
    .eq("team_signup_id", team.id)
    .eq("status", "accepted");
  if ((count ?? 0) < ctx.teamSize)
    await supabaseAdmin.from("team_signups").update({ formed_at: null }).eq("id", team.id);

  refresh();
  return { ok: true, message: `You left the team.${handover}` };
}

export async function disbandTeam(tournamentId: string) {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };

  const { data: team } = await supabaseAdmin
    .from("team_signups")
    .select("id")
    .eq("tournament_id", ctx.tournamentId)
    .eq("creator_player_id", ctx.playerId)
    .maybeSingle();
  if (!team) return { error: "You don't have a team to disband." };

  await supabaseAdmin.from("team_signups").delete().eq("id", team.id);
  refresh();
  return { ok: true, message: "Team disbanded." };
}
