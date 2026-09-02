"use server";

import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

const ONE_YEAR = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark" | "crl6mans" | "sponsor";
const THEMES: Theme[] = ["light", "dark", "crl6mans", "sponsor"];

export async function setTheme(theme: Theme) {
  if (!THEMES.includes(theme)) return { error: "Invalid theme." };

  const cookieStore = await cookies();

  // Mirror to a cookie so the root layout can render the right theme with no flash.
  cookieStore.set("theme", theme, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });

  // Persist to accounts (Tier 1) — the OAuth callback reads the saved theme
  // back from there on every login, so writing only the legacy `players` copy
  // made the choice survive in this browser's cookie and nowhere else.
  const session = await decrypt(cookieStore.get("session")?.value);
  if (session?.userId) {
    await supabaseAdmin
      .from("accounts")
      .update({ theme, updated_at: new Date().toISOString() })
      .eq("discord_id", session.userId);
  }

  return { ok: true };
}
