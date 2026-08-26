"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { hasActiveVerifiedPlatformAccount, isJoinGateEnabled } from "@/app/lib/platform-account-gate";

const ROSTER_MAX = 4; // 3 starters + 1 substitute
const TEAM_MIN = 3;

type Ctx = {
  playerId: string;
  tournamentId: string;
  registrationOpen: boolean;
};

/** Resolve the current approved player against a specific team-signup tournament. */
async function getContext(tournamentId: string): Promise<{ ctx?: Ctx; error?: string }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status")
    .eq("discord_id", session.userId)
    .single();
  if (!player) return { error: "No player profile found." };
  if (player.status !== "approved") return { error: "Only approved players can join tournaments." };

  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("join_mode, signups_open, signups_closed, status, draft_open_at, draft_close_at")
    .eq("id", tournamentId)
    .single();
  if (!t) return { error: "Tournament not found." };
  if (t.join_mode !== "teams") return { error: "This tournament does not use team sign-ups." };

  const now = Date.now();
  const withinWindow = t.draft_open_at && now >= new Date(t.draft_open_at).getTime() && (!t.draft_close_at || now < new Date(t.draft_close_at).getTime());
  const signupsClosed = !!(t as { signups_closed?: boolean }).signups_closed;
  const registrationOpen = t.status === "scheduled" && !signupsClosed && (!!t.signups_open || !!withinWindow);

  return {
    ctx: { playerId: player.id, tournamentId, registrationOpen },
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

/** Resolve which tournament a member row belongs to (for member-scoped actions). */
async function tournamentForMember(memberId: string): Promise<string | null> {
  const { data: member } = await supabaseAdmin
    .from("team_signup_members").select("team_signup_id").eq("id", memberId).single();
  if (!member) return null;
  const { data: ts } = await supabaseAdmin
    .from("team_signups").select("tournament_id").eq("id", member.team_signup_id).single();
  return (ts?.tournament_id as string | null) ?? null;
}

async function checkJoinGate(playerId: string): Promise<string | null> {
  if (!(await isJoinGateEnabled())) return null;
  if (await hasActiveVerifiedPlatformAccount(playerId, new Date())) return null;
  return "You need a verified platform account before joining a team. Add one in Settings → Platform Accounts.";
}

function refresh() {
  revalidatePath("/dashboard");
}

export async function createTeam(tournamentId: string, name: string) {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };
  if (!ctx.registrationOpen) return { error: "Team registration is closed." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Team name is required." };
  if (trimmed.length > 30) return { error: "Team name is too long (30 char max)." };
  if (!/^[a-zA-Z0-9 ]+$/.test(trimmed)) return { error: "Team name can only contain letters, numbers, and spaces." };

  const existing = await findMyTeam(ctx.playerId, ctx.tournamentId);
  if (existing) return { error: "You're already on a team." };

  const gateError = await checkJoinGate(ctx.playerId);
  if (gateError) return { error: gateError };

  const { data: dup } = await supabaseAdmin
    .from("team_signups")
    .select("id")
    .eq("tournament_id", ctx.tournamentId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (dup) return { error: "A team with that name already exists." };

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

  refresh();
  return { ok: true, message: `Team "${trimmed}" created. Invite up to ${ROSTER_MAX - 1} players.` };
}

export async function invitePlayer(tournamentId: string, targetPlayerId: string) {
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };
  if (!ctx.registrationOpen) return { error: "Team registration is closed." };

  const { data: team } = await supabaseAdmin
    .from("team_signups")
    .select("id, team_signup_members(player_id, status)")
    .eq("tournament_id", ctx.tournamentId)
    .eq("creator_player_id", ctx.playerId)
    .maybeSingle();
  if (!team) return { error: "Only a team's creator can invite players." };
  if (targetPlayerId === ctx.playerId) return { error: "You're already on the team." };

  const members = team.team_signup_members as { player_id: string; status: string }[];
  if (members.length >= ROSTER_MAX)
    return { error: `Roster is full (max ${ROSTER_MAX} including pending invites).` };
  if (members.some((m) => m.player_id === targetPlayerId))
    return { error: "That player is already invited or on the team." };

  const { data: target } = await supabaseAdmin
    .from("players").select("id, status").eq("id", targetPlayerId).single();
  if (!target || target.status !== "approved") return { error: "That player isn't approved." };

  const targetTeam = await findMyTeam(targetPlayerId, ctx.tournamentId);
  if (targetTeam) return { error: "That player is already on a team." };

  const { error: insErr } = await supabaseAdmin.from("team_signup_members").insert({
    team_signup_id: team.id,
    player_id: targetPlayerId,
    status: "invited",
  });
  if (insErr) return { error: insErr.message };

  refresh();
  return { ok: true, message: "Invite sent." };
}

export async function revokeInvite(memberId: string) {
  const tournamentId = await tournamentForMember(memberId);
  if (!tournamentId) return { error: "Invite not found." };
  const { ctx, error } = await getContext(tournamentId);
  if (error || !ctx) return { error: error ?? "Unavailable." };

  const { data: member } = await supabaseAdmin
    .from("team_signup_members")
    .select("id, status, team_signup_id")
    .eq("id", memberId)
    .single();
  if (!member) return { error: "Invite not found." };
  const { data: ts } = await supabaseAdmin
    .from("team_signups").select("creator_player_id").eq("id", member.team_signup_id).single();
  if (ts?.creator_player_id !== ctx.playerId) return { error: "Not allowed." };
  if (member.status !== "invited") return { error: "That player already accepted." };

  await supabaseAdmin.from("team_signup_members").delete().eq("id", memberId);
  refresh();
  return { ok: true, message: "Invite revoked." };
}

export async function respondInvite(memberId: string, accept: boolean) {
  const tournamentId = await tournamentForMember(memberId);
  if (!tournamentId) return { error: "Invite not found." };
  const { ctx, error } = await getContext(tournamentId);
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

  if (!ctx.registrationOpen) return { error: "Team registration is closed." };

  const existing = await findMyTeam(ctx.playerId, ctx.tournamentId);
  if (existing) return { error: "You're already on a team." };

  const gateError = await checkJoinGate(ctx.playerId);
  if (gateError) return { error: gateError };

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
  if ((count ?? 0) >= TEAM_MIN) {
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
  if (team.creator_player_id === ctx.playerId)
    return { error: "The creator can't leave — disband the team instead." };

  await supabaseAdmin
    .from("team_signup_members")
    .delete()
    .eq("team_signup_id", team.id)
    .eq("player_id", ctx.playerId);

  const { count } = await supabaseAdmin
    .from("team_signup_members")
    .select("*", { count: "exact", head: true })
    .eq("team_signup_id", team.id)
    .eq("status", "accepted");
  if ((count ?? 0) < TEAM_MIN)
    await supabaseAdmin.from("team_signups").update({ formed_at: null }).eq("id", team.id);

  refresh();
  return { ok: true, message: "You left the team." };
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
