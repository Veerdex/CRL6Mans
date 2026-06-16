"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Marks the onboarding tab as seen (cookie) and sends the player home. Once set,
// the layout stops showing the "Get Started" tab and this page redirects away.
export async function dismissWelcome() {
  const cookieStore = await cookies();
  cookieStore.set("welcome_seen", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 5, // 5 years
    sameSite: "lax",
  });
  redirect("/dashboard");
}
