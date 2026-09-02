"use server";

import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

const ONE_YEAR = 60 * 60 * 24 * 365;

export type NavLayout = "sidebar" | "topbar";
const LAYOUTS: NavLayout[] = ["sidebar", "topbar"];

export async function setNavLayout(layout: NavLayout) {
  if (!LAYOUTS.includes(layout)) return { error: "Invalid layout." };

  const cookieStore = await cookies();

  // Mirror to a cookie so the dashboard layout renders the right chrome on the server.
  cookieStore.set("nav_layout", layout, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });

  // Persist to accounts (Tier 1) — see setTheme for why the legacy `players`
  // copy isn't the source of truth any more.
  const session = await decrypt(cookieStore.get("session")?.value);
  if (session?.userId) {
    await supabaseAdmin
      .from("accounts")
      .update({ nav_layout: layout, updated_at: new Date().toISOString() })
      .eq("discord_id", session.userId);
  }

  return { ok: true };
}
