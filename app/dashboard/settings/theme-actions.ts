"use server";

import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

const ONE_YEAR = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark" | "crl6mans";
const THEMES: Theme[] = ["light", "dark", "crl6mans"];

export async function setTheme(theme: Theme) {
  if (!THEMES.includes(theme)) return { error: "Invalid theme." };

  const cookieStore = await cookies();

  // Mirror to a cookie so the root layout can render the right theme with no flash.
  cookieStore.set("theme", theme, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });

  // Persist to the DB (source of truth) for the logged-in player.
  const session = await decrypt(cookieStore.get("session")?.value);
  if (session?.userId) {
    await supabaseAdmin
      .from("players")
      .update({ theme, updated_at: new Date().toISOString() })
      .eq("discord_id", session.userId);
  }

  return { ok: true };
}
