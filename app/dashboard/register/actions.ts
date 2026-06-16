"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { pushToAdmins } from "@/app/lib/push";
import { logAnalyticsEvent } from "@/app/lib/analytics";
import { sendDm } from "@/app/lib/discord-api";
import { APP_NAME } from "@/app/lib/constants";
import { validateImageUpload } from "@/app/lib/uploads";

export async function registerPlayer(_prevState: unknown, formData: FormData) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  if (!session?.userId) redirect("/login");

  const trackerUrl  = formData.get("tracker_url")  as string;
  const peak3v3     = formData.get("peak_3v3")     as string;
  const current3v3  = formData.get("current_3v3")  as string;
  const peak2v2     = formData.get("peak_2v2")     as string;
  const current2v2  = formData.get("current_2v2")  as string;
  const subWilling  = formData.get("sub_willing") === "on";
  const file        = formData.get("college_image") as File;

  if (!trackerUrl || !peak3v3 || !current3v3 || !peak2v2 || !current2v2) {
    return { error: "All fields are required." };
  }

  // Validate tracker URL format
  try {
    new URL(trackerUrl);
  } catch {
    return { error: "Please enter a valid tracker URL." };
  }

  // Validate MMR values are non-negative integers
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
    if (n > 3000) {
      return { error: `${label} cannot exceed 3000.` };
    }
  }

  // Look up any existing registration so we can check status and fall back to its image
  const { data: existing } = await supabaseAdmin
    .from("players")
    .select("status, college_image_url")
    .eq("discord_id", session.userId)
    .single();

  // Guard against corrupting approved/pending records via direct POST
  if (existing?.status === "approved") {
    return { error: "Your registration is already approved." };
  }
  if (existing?.status === "pending") {
    return { error: "Your registration is already pending review." };
  }

  let collegeImageUrl: string;
  let uploadedFileName: string | null = null;

  if (file?.size) {
    const validated = validateImageUpload(file);
    if ("error" in validated) return { error: validated.error };

    const fileName = `${session.userId}-${Date.now()}.${validated.ext}`;
    const bytes    = await file.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from("college-ids")
      .upload(fileName, bytes, { contentType: validated.contentType, upsert: true });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return { error: "Failed to upload image. Please try again." };
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("college-ids")
      .getPublicUrl(fileName);

    uploadedFileName = fileName;
    collegeImageUrl = urlData.publicUrl;
  } else if (existing?.college_image_url) {
    collegeImageUrl = existing.college_image_url;
  } else {
    return { error: "College enrollment proof is required." };
  }

  const { error: dbError } = await supabaseAdmin.from("players").upsert({
    discord_id:        session.userId,
    username:          session.username,
    avatar:            session.avatar,
    status:            "pending",
    tracker_url:       trackerUrl,
    peak_3v3:          peak3v3,
    current_3v3:       current3v3,
    peak_2v2:          peak2v2,
    current_2v2:       current2v2,
    college_image_url: collegeImageUrl,
    sub_willing:       subWilling,
    tracker_confirmed_at: new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }, { onConflict: "discord_id" });

  if (dbError) {
    console.error("DB insert error:", dbError);
    // Clean up the file we just uploaded so storage doesn't accumulate orphans
    if (uploadedFileName) {
      await supabaseAdmin.storage.from("college-ids").remove([uploadedFileName]);
    }
    return { error: "Failed to submit registration. Please try again." };
  }

  revalidatePath("/dashboard/admin");

  logAnalyticsEvent("registration").catch(() => {});

  pushToAdmins({
    title: "New Registration",
    body: `${session.username ?? "A player"} submitted a registration and is pending review.`,
    url: "/dashboard/admin",
    tag: "registration",
  }, "registrations").catch(() => {});

  const inviteUrl = process.env.DISCORD_INVITE_URL;
  if (inviteUrl) {
    sendDm(
      session.userId,
      `👋 Thanks for registering for ${APP_NAME}! Your registration is pending admin review.\n\nJoin our Discord server to stay up to date: ${inviteUrl}`
    ).catch(() => {});
  }

  return { success: true, error: "" };
}
