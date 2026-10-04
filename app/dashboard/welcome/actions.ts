"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { WELCOME_SEEN_COOKIE, WELCOME_SEEN_MAX_AGE } from "./welcome-seen";

// Marks the onboarding tab as seen on the account (and in a cookie as a fast
// path) and sends the player home. Once set, the layout stops showing the
// "Get Started" tab and this page redirects away.
export async function dismissWelcome() {
  const cookieStore = await cookies();
  cookieStore.set(WELCOME_SEEN_COOKIE, "1", {
    path: "/",
    maxAge: WELCOME_SEEN_MAX_AGE,
    sameSite: "lax",
  });
  const session = await decrypt(cookieStore.get("session")?.value);
  if (session?.userId) {
    await supabaseAdmin
      .from("accounts")
      .update({ welcome_seen_at: new Date().toISOString() })
      .eq("discord_id", session.userId)
      .is("welcome_seen_at", null);
  }
  redirect("/dashboard");
}
