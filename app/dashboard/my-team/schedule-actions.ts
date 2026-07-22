"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { roleMention, notifyMatchChannel } from "@/app/lib/match-notifications";
import { canonicalStage } from "@/app/dashboard/admin/schedule-utils";
import { pushToAdmins } from "@/app/lib/push";
import { createChannelIfCheckedIn, processExpiredCheckIns, openReadyMatchChannels } from "@/app/lib/discord-bot";

type AdminSchedule = { type: string; playAt: string; deadlineAt: string };

// The admin-set schedule for a match's round, if any.
async function getAdminSchedule(stage: string, round: number): Promise<AdminSchedule | null> {
  const { data: ls } = await supabaseAdmin
    .from("league_settings").select("active_tournament_id").maybeSingle();
  const tid = (ls?.active_tournament_id as string | null) ?? null;
  const cs = canonicalStage(stage);
  const q = tid
    ? supabaseAdmin.from("round_schedules").select("schedule_type, play_at, deadline_at").eq("tournament_id", tid).eq("stage", cs).eq("round", round).maybeSingle()
    : supabaseAdmin.from("round_schedules").select("schedule_type, play_at, deadline_at").is("tournament_id", null).eq("stage", cs).eq("round", round).maybeSingle();
  const { data } = await q;
  return data
    ? { type: data.schedule_type as string, playAt: data.play_at as string, deadlineAt: data.deadline_at as string }
    : null;
}

// Whether a proposed time falls inside the admin's allowed window. A range is just
// the stored [playAt, deadlineAt] instant range (zone-independent); specific is the
// exact scheduled time.
function isInWindow(ms: number, sched: AdminSchedule): boolean {
  if (sched.type === "range") {
    return ms >= new Date(sched.playAt).getTime() && ms <= new Date(sched.deadlineAt).getTime();
  }
  return ms === new Date(sched.playAt).getTime();
}

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

type MatchRow = {
  home_team_id: string;
  away_team_id: string;
  status: string;
  stage: string;
  round: number;
  scheduled_at: string | null;
  schedule_proposed_by_team_id: string | null;
  schedule_accepted: boolean;
  schedule_admin_required: boolean;
  admin_scheduled: boolean;
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
      "home_team_id, away_team_id, status, stage, round, scheduled_at, schedule_proposed_by_team_id, schedule_accepted, schedule_admin_required, admin_scheduled",
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
): Promise<{ ok?: boolean; error?: string; adminRequired?: boolean }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  const dt = new Date(scheduledAt);
  if (isNaN(dt.getTime())) return { error: "Invalid date/time." };
  if (dt.getTime() <= Date.now()) return { error: "Scheduled time must be in the future." };

  // Out-of-window proposals are still sent to the opponent, but flagged so they
  // require admin approval after the opponent confirms. Rescheduling an admin-pinned
  // match always needs admin approval (treated like a fixed "specific" time), and the
  // proposal supersedes the pin.
  const adminSched = await getAdminSchedule(match.stage, match.round);
  const adminRequired = match.admin_scheduled
    ? true
    : adminSched ? !isInWindow(dt.getTime(), adminSched) : false;

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: dt.toISOString(),
      schedule_proposed_by_team_id: myTeamId,
      schedule_accepted: false,
      schedule_admin_required: adminRequired,
      admin_scheduled: false,
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
      const note = adminRequired
        ? "\n⚠️ This time is **outside the scheduled window**, so it will need admin approval after you confirm."
        : "\nHead to the website to confirm or suggest a different time.";
      await notifyMatchChannel(
        matchId,
        `${mention} 📅 **${myTeam.name}** has ${verb} match time: <t:${ts}:F> (<t:${ts}:R>)${note}`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true, adminRequired };
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

  const needsAdmin = match.schedule_admin_required;

  try {
    const proposerTeamId = match.schedule_proposed_by_team_id;
    const [{ data: myTeam }, { data: proposerTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
      supabaseAdmin.from("teams").select("name").eq("id", proposerTeamId).single(),
    ]);
    if (myTeam?.name && proposerTeam?.name) {
      const mention = await roleMention(proposerTeam.name);
      const ts = Math.floor(new Date(match.scheduled_at).getTime() / 1000);
      const msg = needsAdmin
        ? `${mention} 🕓 **${myTeam.name}** confirmed the out-of-window time: <t:${ts}:F>. Awaiting admin approval before it's locked in.`
        : `${mention} ✅ **${myTeam.name}** confirmed the match time: <t:${ts}:F>. See you then! 🎮`;
      await notifyMatchChannel(matchId, msg);
    }
  } catch { /* best-effort */ }

  // Out-of-window times need an admin to sign off after both teams agree.
  if (needsAdmin) {
    try {
      await pushToAdmins({
        title: "Match time needs approval",
        body: "Two teams agreed on a time outside the scheduled window. Review it in the Admin panel.",
        url: "/dashboard/admin",
        tag: "schedule-override",
      }, "schedule_approvals");
    } catch { /* best-effort */ }
  }

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
      schedule_admin_required: false,
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
      schedule_admin_required: false,
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

// ─── Tournament check-in ────────────────────────────────────────────────────────

const CHECKIN_WINDOW_MS = 10 * 60 * 1000;

export async function checkInForMatch(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId } = ctx;

  const { data: m } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, checkin_deadline, home_checked_in, away_checked_in")
    .eq("id", matchId)
    .maybeSingle();
  if (!m) return { error: "Match not found." };
  if (!m.checkin_deadline) return { error: "Check-in hasn't opened yet." };

  const deadline = new Date(m.checkin_deadline as string).getTime();
  const now = Date.now();
  if (now < deadline - CHECKIN_WINDOW_MS) return { error: "Check-in hasn't opened yet." };
  if (now > deadline) return { error: "The check-in window has closed." };

  const isHome = myTeamId === m.home_team_id;
  await supabaseAdmin
    .from("matches")
    .update({ [isHome ? "home_checked_in" : "away_checked_in"]: true })
    .eq("id", matchId);

  // If this completes the pair, create the match channel immediately.
  const bothNow = isHome ? !!m.away_checked_in : !!m.home_checked_in;
  if (bothNow) await createChannelIfCheckedIn(matchId).catch(() => {});

  revalidatePath("/dashboard/my-team");
  return { ok: true };
}

// Client-fired when a check-in deadline passes while someone has the page open —
// processes expired check-ins (DQs) and opens any newly-ready channels. Idempotent.
export async function processCheckInsNow(): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session?.userId) return { ok: false };
  await processExpiredCheckIns().catch(() => {});
  await openReadyMatchChannels().catch(() => {});
  revalidatePath("/dashboard/my-team");
  return { ok: true };
}
