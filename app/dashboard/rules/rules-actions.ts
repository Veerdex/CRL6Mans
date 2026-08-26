"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export async function updateRulesMarkdown(
  markdown: string
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId || !(await isDirectorVerified(session.userId))) {
    return { error: "Only Directors can edit the rules." };
  }

  const trimmed = markdown.trim();

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ rules_markdown: trimmed || null })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/rules");
  revalidatePath("/dashboard");
  return { ok: true };
}
