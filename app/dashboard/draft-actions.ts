"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { execAutoPick } from "@/app/lib/discord-bot";
import { isGuildMember } from "@/app/lib/discord-api";
import { isTrackerStale } from "@/app/lib/tracker";
import { logAnalyticsEvent } from "@/app/lib/analytics";
import { hasActiveVerifiedPlatformAccount, isJoinGateEnabled } from "@/app/lib/platform-account-gate";
import { isCurrentlyKicked } from "@/app/lib/players";

export async function triggerAutoPick(): Promise<{ done: boolean }> {
  // Fired by the draft client when a pick deadline passes. execAutoPick is
  // idempotent and only acts when the timer has actually expired, but require a
  // session so it isn't an open, unauthenticated trigger.
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { done: true };
  return execAutoPick();
}

export async function enterDraft(confirmTrackerSame = false): Promise<{ error?: string; ok?: boolean; inviteRequired?: boolean; trackerStale?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, draft_entered, kick_reason, kicked_until, tracker_confirmed_at, peak_2v2, peak_3v3")
    .eq("discord_id", session.userId)
    .single();

  if (!player) return { error: "You are not registered." };
  if (player.status !== "approved") return { error: "Your registration must be approved first." };
  if (isCurrentlyKicked(player.kick_reason, player.kicked_until)) return { error: "You are not eligible to join the draft." };
  if (player.draft_entered) return { error: "You are already in the draft." };

  const inServer = await isGuildMember(session.userId);
  if (!inServer) return { inviteRequired: true };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("draft_open, min_mmr_2v2, min_mmr_3v3")
    .single();

  if (!settings?.draft_open) return { error: "Draft signups are not currently open." };

  if ((await isJoinGateEnabled()) && !(await hasActiveVerifiedPlatformAccount(player.id, new Date())))
    return { error: "You need a verified platform account before joining the draft. Add one in Settings → Platform Accounts." };

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

  if (!confirmTrackerSame && isTrackerStale(player.tracker_confirmed_at)) {
    return { trackerStale: true };
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { draft_entered: true, draft_entered_at: now, updated_at: now };
  if (confirmTrackerSame) { update.tracker_confirmed_at = now; update.must_update_tracker = false; }

  await supabaseAdmin.from("players").update(update).eq("id", player.id);

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
    .select("draft_active, season_active")
    .single();

  if (settings?.draft_active || settings?.season_active) {
    return { error: "You cannot leave the draft once the draft or season has started." };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, draft_entered")
    .eq("discord_id", session.userId)
    .single();

  if (!player) return { error: "You are not registered." };
  if (!player.draft_entered) return { error: "You are not in the draft." };

  await supabaseAdmin
    .from("players")
    .update({ draft_entered: false, updated_at: new Date().toISOString() })
    .eq("id", player.id);

  revalidatePath("/dashboard");
  return { ok: true };
}
