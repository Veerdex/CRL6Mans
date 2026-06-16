"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { roleMention, notifyMatchChannel } from "@/app/lib/match-notifications";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

type MatchRow = {
  home_team_id: string;
  away_team_id: string;
  status: string;
  scheduled_at: string | null;
  schedule_proposed_by_team_id: string | null;
  schedule_accepted: boolean;
};

async function getCaptainContext(matchId: string): Promise<
  | { ok: true; myTeamId: string; match: MatchRow }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select(
      "home_team_id, away_team_id, status, scheduled_at, schedule_proposed_by_team_id, schedule_accepted",
    )
    .eq("id", matchId)
    .single();

  if (!match) return { ok: false, error: "Match not found." };
  if (match.status === "completed")
    return { ok: false, error: "This match is already completed." };

  if (await isModerator(session.userId)) {
    return { ok: true, myTeamId: match.home_team_id as string, match: match as MatchRow };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("discord_id", session.userId)
    .single();

  if (!player?.team_id) return { ok: false, error: "You are not on a team." };
  if (player.team_id !== match.home_team_id && player.team_id !== match.away_team_id)
    return { ok: false, error: "You are not in this match." };

  return { ok: true, myTeamId: player.team_id as string, match: match as MatchRow };
}

export async function proposeMatchTime(
  matchId: string,
  scheduledAt: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  const dt = new Date(scheduledAt);
  if (isNaN(dt.getTime())) return { error: "Invalid date/time." };
  if (dt.getTime() <= Date.now()) return { error: "Scheduled time must be in the future." };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: dt.toISOString(),
      schedule_proposed_by_team_id: myTeamId,
      schedule_accepted: false,
    })
    .eq("id", matchId);

  if (error) return { error: `Failed to save: ${error.message}` };

  try {
    const otherTeamId = myTeamId === match.home_team_id ? match.away_team_id : match.home_team_id;
    const [{ data: myTeam }, { data: otherTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
      supabaseAdmin.from("teams").select("name").eq("id", otherTeamId).single(),
    ]);
    if (myTeam?.name && otherTeam?.name) {
      const mention = await roleMention(otherTeam.name);
      const ts = Math.floor(dt.getTime() / 1000);
      const verb = match.scheduled_at ? "proposed a new" : "proposed a";
      await notifyMatchChannel(
        matchId,
        `${mention} 📅 **${myTeam.name}** has ${verb} match time: <t:${ts}:F> (<t:${ts}:R>)\nHead to the website to confirm or suggest a different time.`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function acceptMatchTime(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  if (!match.scheduled_at || !match.schedule_proposed_by_team_id)
    return { error: "No match time has been proposed yet." };
  if (match.schedule_accepted) return { error: "This time has already been accepted." };
  if (myTeamId === match.schedule_proposed_by_team_id)
    return { error: "You cannot accept your own proposal." };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({ schedule_accepted: true })
    .eq("id", matchId);

  if (error) return { error: `Failed to accept: ${error.message}` };

  try {
    const proposerTeamId = match.schedule_proposed_by_team_id;
    const [{ data: myTeam }, { data: proposerTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
      supabaseAdmin.from("teams").select("name").eq("id", proposerTeamId).single(),
    ]);
    if (myTeam?.name && proposerTeam?.name) {
      const mention = await roleMention(proposerTeam.name);
      const ts = Math.floor(new Date(match.scheduled_at).getTime() / 1000);
      await notifyMatchChannel(
        matchId,
        `${mention} ✅ **${myTeam.name}** confirmed the match time: <t:${ts}:F>. See you then! 🎮`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function withdrawMatchTime(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: null,
      schedule_proposed_by_team_id: null,
      schedule_accepted: false,
    })
    .eq("id", matchId);

  if (error) return { error: `Failed to withdraw: ${error.message}` };

  try {
    const otherTeamId = myTeamId === match.home_team_id ? match.away_team_id : match.home_team_id;
    const [{ data: myTeam }, { data: otherTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
      supabaseAdmin.from("teams").select("name").eq("id", otherTeamId).single(),
    ]);
    if (myTeam?.name && otherTeam?.name) {
      const mention = await roleMention(otherTeam.name);
      await notifyMatchChannel(
        matchId,
        `${mention} ↩️ **${myTeam.name}** removed the proposed match time.`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function rejectMatchTime(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  if (!match.scheduled_at || !match.schedule_proposed_by_team_id)
    return { error: "No match time has been proposed." };
  if (myTeamId === match.schedule_proposed_by_team_id)
    return { error: "You cannot reject your own proposal." };

  const proposedTs = Math.floor(new Date(match.scheduled_at).getTime() / 1000);

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: null,
      schedule_proposed_by_team_id: null,
      schedule_accepted: false,
    })
    .eq("id", matchId);

  if (error) return { error: `Failed to reject: ${error.message}` };

  try {
    const proposerTeamId = match.schedule_proposed_by_team_id;
    const [{ data: myTeam }, { data: proposerTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
      supabaseAdmin.from("teams").select("name").eq("id", proposerTeamId).single(),
    ]);
    if (myTeam?.name && proposerTeam?.name) {
      const mention = await roleMention(proposerTeam.name);
      await notifyMatchChannel(
        matchId,
        `${mention} ❌ **${myTeam.name}** rejected the proposed match time (<t:${proposedTs}:F>). Please propose a new time.`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
