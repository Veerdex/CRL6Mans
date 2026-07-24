"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { pushToAdmins } from "@/app/lib/push";
import { isCurrentlyKicked } from "@/app/lib/players";

function validateMmr(label: string, val: string): string | null {
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) return `${label} must be a non-negative whole number.`;
  if (n > 3000) return `${label} cannot exceed 3000.`;
  return null;
}

export async function requestProfileChange(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const trackerUrl = (formData.get("tracker_url") as string)?.trim();
  const peak3v3    = (formData.get("peak_3v3")    as string)?.trim();
  const current3v3 = (formData.get("current_3v3") as string)?.trim();
  const peak2v2    = (formData.get("peak_2v2")    as string)?.trim();
  const current2v2 = (formData.get("current_2v2") as string)?.trim();
  const subWilling = formData.get("sub_willing") === "on";

  if (!trackerUrl || !peak3v3 || !current3v3 || !peak2v2 || !current2v2)
    return { error: "All fields are required." };

  try { new URL(trackerUrl); } catch {
    return { error: "Please enter a valid tracker URL." };
  }

  for (const [label, val] of [
    ["Peak 3v3",    peak3v3],
    ["Current 3v3", current3v3],
    ["Peak 2v2",    peak2v2],
    ["Current 2v2", current2v2],
  ] as [string, string][]) {
    const err = validateMmr(label, val);
    if (err) return { error: err };
  }
  if (Number(current3v3) > Number(peak3v3)) return { error: "Current 3v3 MMR cannot exceed Peak 3v3." };
  if (Number(current2v2) > Number(peak2v2)) return { error: "Current 2v2 MMR cannot exceed Peak 2v2." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, username, status, kick_reason, kicked_until, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2")
    .eq("discord_id", session.userId)
    .single();

  if (player?.status !== "approved" || isCurrentlyKicked(player?.kick_reason ?? null, player?.kicked_until ?? null)) redirect("/dashboard");

  // sub_willing is a preference with no competitive impact — apply immediately
  await supabaseAdmin
    .from("players")
    .update({ sub_willing: subWilling, updated_at: new Date().toISOString() })
    .eq("discord_id", session.userId);

  // Only create a request if something actually differs from the live values
  const unchanged =
    trackerUrl === (player.tracker_url ?? "").trim() &&
    Number(peak3v3)    === Number(player.peak_3v3) &&
    Number(current3v3) === Number(player.current_3v3) &&
    Number(peak2v2)    === Number(player.peak_2v2) &&
    Number(current2v2) === Number(player.current_2v2);
  if (unchanged) return { error: "No changes to request — update a value first." };

  // Delete any existing pending request for this player, then insert a fresh one
  await supabaseAdmin
    .from("player_edit_requests")
    .delete()
    .eq("player_id", player.id)
    .eq("status", "pending");

  const { error } = await supabaseAdmin.from("player_edit_requests").insert({
    player_id:   player.id,
    discord_id:  session.userId,
    username:    session.username ?? player.username ?? "Unknown",
    tracker_url: trackerUrl,
    peak_3v3:    peak3v3,
    current_3v3: current3v3,
    peak_2v2:    peak2v2,
    current_2v2: current2v2,
  });

  if (error) return { error: "Failed to submit request. Please try again." };

  revalidatePath("/dashboard/settings");

  pushToAdmins({
    title: "Profile Change Request",
    body: `${session.username ?? "A player"} submitted a profile change request.`,
    url: "/dashboard/admin",
    tag: "profile-request",
  }, "profile_changes").catch(() => {});

  return { ok: true };
}

// Self-service: a player marks their tracker as re-verified, clearing the
// admin-forced "must update tracker" flag and refreshing tracker_confirmed_at.
export async function confirmTrackerCurrent(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { error } = await supabaseAdmin
    .from("players")
    .update({
      tracker_confirmed_at: new Date().toISOString(),
      must_update_tracker: false,
      updated_at: new Date().toISOString(),
    })
    .eq("discord_id", session.userId);

  if (error) return { error: "Failed to confirm tracker." };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function saveNotificationPrefs(
  prefs: Record<string, boolean>
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("status")
    .eq("discord_id", session.userId)
    .single();

  if (player?.status !== "approved") redirect("/dashboard");

  const { error } = await supabaseAdmin
    .from("players")
    .update({ notification_prefs: prefs, updated_at: new Date().toISOString() })
    .eq("discord_id", session.userId);

  if (error) return { error: "Failed to save preferences." };
  return { ok: true };
}

export async function dismissRejectedRequest(
  requestId: string
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players").select("id").eq("discord_id", session.userId).single();
  if (!player) return { error: "Player not found." };

  await supabaseAdmin
    .from("player_edit_requests")
    .delete()
    .eq("id", requestId)
    .eq("player_id", player.id)
    .eq("status", "rejected");

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function cancelProfileRequest(
  requestId: string
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players").select("id").eq("discord_id", session.userId).single();
  if (!player) return { error: "Player not found." };

  const { error } = await supabaseAdmin
    .from("player_edit_requests")
    .delete()
    .eq("id", requestId)
    .eq("player_id", player.id)
    .eq("status", "pending");

  if (error) return { error: "Failed to cancel request." };

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function saveDisplayName(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const raw = (formData.get("display_name") as string ?? "").trim();

  if (raw.length > 30) return { error: "Nickname must be 30 characters or fewer." };
  if (/@everyone|@here|<@/i.test(raw)) return { error: "Nickname cannot contain Discord mentions." };

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("status, kick_reason, kicked_until")
    .eq("discord_id", session.userId)
    .single();

  if (player?.status !== "approved" || isCurrentlyKicked(player?.kick_reason ?? null, player?.kicked_until ?? null)) redirect("/dashboard");

  const display_name = raw.length > 0 ? raw : null;

  const { error } = await supabaseAdmin
    .from("players")
    .update({ display_name, updated_at: new Date().toISOString() })
    .eq("discord_id", session.userId);

  if (error) return { error: "Failed to save nickname." };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}
