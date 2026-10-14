"use server";

import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { NAV_LAYOUTS, NAV_LAYOUT_COOKIE, type NavLayout } from "@/app/lib/nav-layout";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Don't re-export the type from here. The "use server" transform emits a
// runtime reference for every export name, but a type binding is erased, so
// the whole chunk throws `NavLayout is not defined` on evaluation and every
// action the Settings page can call 500s. Import it from lib/nav-layout.
export async function setNavLayout(layout: NavLayout) {
  if (!NAV_LAYOUTS.includes(layout)) return { error: "Invalid layout." };

  const cookieStore = await cookies();

  // Mirror to a cookie so the dashboard layout renders the right chrome on the server.
  cookieStore.set(NAV_LAYOUT_COOKIE, layout, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });

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
