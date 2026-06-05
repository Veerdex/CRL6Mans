"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

export async function updatePlayerSettings(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const trackerUrl = formData.get("tracker_url") as string;
  const peak3v3    = formData.get("peak_3v3")    as string;
  const current3v3 = formData.get("current_3v3") as string;
  const peak2v2    = formData.get("peak_2v2")    as string;
  const current2v2 = formData.get("current_2v2") as string;

  if (!trackerUrl || !peak3v3 || !current3v3 || !peak2v2 || !current2v2) {
    return { error: "All fields are required." };
  }

  try {
    new URL(trackerUrl);
  } catch {
    return { error: "Please enter a valid tracker URL." };
  }

  for (const [label, val] of [
    ["Peak 3v3", peak3v3],
    ["Current 3v3", current3v3],
    ["Peak 2v2", peak2v2],
    ["Current 2v2", current2v2],
  ] as [string, string][]) {
    const n = Number(val);
    if (!Number.isInteger(n) || n < 0) {
      return { error: `${label} must be a non-negative whole number.` };
    }
  }

  const { error } = await supabaseAdmin
    .from("players")
    .update({
      tracker_url:  trackerUrl,
      peak_3v3:     peak3v3,
      current_3v3:  current3v3,
      peak_2v2:     peak2v2,
      current_2v2:  current2v2,
      updated_at:   new Date().toISOString(),
    })
    .eq("discord_id", session.userId)
    .eq("status", "approved");

  if (error) {
    console.error("Settings update error:", error);
    return { error: "Failed to save settings. Please try again." };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
