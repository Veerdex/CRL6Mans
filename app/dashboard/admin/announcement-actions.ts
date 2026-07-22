"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { sendChannelMessage } from "@/app/lib/discord-api";
import { pushToAllApproved } from "@/app/lib/push";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

function stripMarkdownForPush(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\|\|(.+?)\|\|/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/([*_`])(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

export async function postAnnouncement(text: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirector(session.userId))) return { error: "Only Directors can post announcements." };

  const trimmed = text.trim();
  if (!trimmed) return { error: "Announcement text is required." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("announcement_channel_id")
    .single();
  const channelId = settings?.announcement_channel_id as string | null;

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({
      announcement_text: trimmed,
      announcement_posted_at: new Date().toISOString(),
      announcement_posted_by: session.userId,
      updated_at: new Date().toISOString(),
    })
    .not("id", "is", null);
  if (error) return { error: error.message };

  if (channelId) await sendChannelMessage(channelId, trimmed);

  await pushToAllApproved({
    title: "Announcement",
    body: stripMarkdownForPush(trimmed).slice(0, 150),
    url: "/dashboard",
    category: "announcement",
  });

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function clearAnnouncement(): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirector(session.userId))) return { error: "Only Directors can clear the announcement." };

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({
      announcement_text: null,
      announcement_posted_at: null,
      announcement_posted_by: null,
      updated_at: new Date().toISOString(),
    })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}
