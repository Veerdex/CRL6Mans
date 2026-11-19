"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { execAutoPick } from "@/app/lib/discord-bot";
import { isGuildMember } from "@/app/lib/discord-api";
import { logAnalyticsEvent } from "@/app/lib/analytics";
import { hasActiveVerifiedPlatformAccount, joinGateApplies } from "@/app/lib/platform-account-gate";
import { isCurrentlyKicked } from "@/app/lib/players";
import { hasMmrOnFile, MMR_REQUIRED_MESSAGE } from "@/app/lib/mmr-on-file";
import { enterSeasonPool, isInSeasonPool, leaveSeasonPool } from "@/app/lib/season-pool";

export async function triggerAutoPick(): Promise<{ done: boolean }> {
  // Fired by the draft client when a pick deadline passes. execAutoPick is
  // idempotent and only acts when the timer has actually expired, but require a
  // session so it isn't an open, unauthenticated trigger.
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { done: true };
  return execAutoPick();
}

export async function enterDraft(confirmedMmr = false): Promise<{ error?: string; ok?: boolean; inviteRequired?: boolean; confirmMmr?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, kick_reason, kicked_until, peak_2v2, peak_3v3")
    .eq("discord_id", session.userId)
    .single();

  if (!player) return { error: "You are not registered." };
  if (player.status !== "approved") return { error: "Your registration must be approved first." };
  if (isCurrentlyKicked(player.kick_reason, player.kicked_until)) return { error: "You are not eligible to join the draft." };
  if (await isInSeasonPool(player.id)) return { error: "You are already in the draft." };

  const inServer = await isGuildMember(session.userId);
  if (!inServer) return { inviteRequired: true };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("draft_open, min_mmr_2v2, min_mmr_3v3, stats_enabled, active_tournament_id")
    .single();

  if (!settings?.draft_open) return { error: "Draft signups are not currently open." };

  // The season draft has no tournament of its own, so the runtime mirror is the
  // event being joined. While a tournament holds the runtime, that mirror is the
  // tournament's, and seasons always run with stats on.
  const seasonStats = settings.active_tournament_id ? true : settings.stats_enabled ?? true;
  if ((await joinGateApplies(seasonStats)) && !(await hasActiveVerifiedPlatformAccount(player.id, new Date())))
    return { error: "You need a verified platform account before joining the draft. Add one in Settings → Platform Accounts." };

  // A player who has never reported their ranks is asked before the MMR gate
  // below, not after: registration doesn't collect MMR, so gating first would
  // refuse them on the zeros they've had no chance to replace. The confirmed
  // pass re-reads the row, so the gate still runs against real numbers.
  const onFile = hasMmrOnFile(player as { peak_2v2?: string; peak_3v3?: string });
  if (!confirmedMmr && !onFile) return { confirmMmr: true };
  if (confirmedMmr && !onFile) return { error: MMR_REQUIRED_MESSAGE };

  // Minimum MMR gate — qualifies by meeting either the 2v2 or 3v3 threshold.
  const min2v2 = (settings.min_mmr_2v2 as number | null) ?? null;
  const min3v3 = (settings.min_mmr_3v3 as number | null) ?? null;
  if (min2v2 || min3v3) {
    const peak2v2 = Number((player as { peak_2v2?: string }).peak_2v2) || 0;
    const peak3v3 = Number((player as { peak_3v3?: string }).peak_3v3) || 0;
    const reqs: { label: string; passes: boolean }[] = [];
    if (min2v2) reqs.push({ label: `${min2v2} 2v2`, passes: peak2v2 >= min2v2 });
    if (min3v3) reqs.push({ label: `${min3v3} 3v3`, passes: peak3v3 >= min3v3 });
    if (reqs.length > 0 && !reqs.some((r) => r.passes))
      return { error: `You need at least ${reqs.map((r) => r.label).join(" or ")} peak MMR to join the draft.` };
  }

  // Every join asks, with no freshness window: a player's MMR can move between
  // two events in the same week, and the prompt is the only thing that makes them
  // look. The last gate, so a player isn't asked only to then be refused.
  if (!confirmedMmr) return { confirmMmr: true };

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("players")
    .update({ updated_at: now, tracker_confirmed_at: now, must_update_tracker: false })
    .eq("id", player.id);
  const entered = await enterSeasonPool([player.id]);
  if (entered.error) return { error: entered.error };

  logAnalyticsEvent("draft_join").catch(() => {});

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function leaveDraft(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/");

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("draft_active, season_active, active_tournament_id")
    .single();

  // With a tournament active, a running draft or season is the tournament's,
  // and the season hasn't started.
  if (!settings?.active_tournament_id && (settings?.draft_active || settings?.season_active)) {
    return { error: "You cannot leave the draft once the draft or season has started." };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("discord_id", session.userId)
    .single();

  if (!player) return { error: "You are not registered." };
  if (!(await isInSeasonPool(player.id))) return { error: "You are not in the draft." };

  await leaveSeasonPool([player.id]);

  revalidatePath("/dashboard");
  return { ok: true };
}
