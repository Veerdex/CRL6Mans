"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { notifyMatchChannel } from "@/app/lib/match-notifications";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModerator(session.userId))) redirect("/dashboard");
}

// Approve an out-of-window time both teams already agreed on — locks it in.
export async function approveScheduleOverride(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  await verifyAdmin();

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("scheduled_at, schedule_accepted, schedule_admin_required")
    .eq("id", matchId)
    .maybeSingle();

  if (!match) return { error: "Match not found." };
  if (!match.schedule_admin_required) return { error: "This match doesn't need approval." };

  await supabaseAdmin
    .from("matches")
    .update({ schedule_admin_required: false })
    .eq("id", matchId);

  try {
    if (match.scheduled_at) {
      const ts = Math.floor(new Date(match.scheduled_at as string).getTime() / 1000);
      await notifyMatchChannel(matchId, `✅ Admin approved the match time: <t:${ts}:F>. It's locked in — see you then! 🎮`);
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}

// Reject an out-of-window time — clears the proposal so teams pick again.
export async function rejectScheduleOverride(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  await verifyAdmin();

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("schedule_admin_required")
    .eq("id", matchId)
    .maybeSingle();

  if (!match) return { error: "Match not found." };
  if (!match.schedule_admin_required) return { error: "This match doesn't need approval." };

  await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: null,
      schedule_proposed_by_team_id: null,
      schedule_accepted: false,
      schedule_admin_required: false,
    })
    .eq("id", matchId);

  try {
    await notifyMatchChannel(matchId, "❌ Admin declined the out-of-window time. Please propose a new time within the scheduled window.");
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}
