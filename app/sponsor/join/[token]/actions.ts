"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabase";
import { createSession } from "@/app/lib/session";

// Re-validates the token here (not just at the link-click) to close the gap
// between viewing the welcome page and pressing Continue, during which the
// sponsor could hit max_uses or get disabled.
export async function joinAsGuest(token: string) {
  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, max_uses")
    .eq("invite_token", token)
    .eq("status", "active")
    .single();
  if (!sponsor) redirect("/login?error=invalid_sponsor_link");

  const { count } = await supabaseAdmin
    .from("sponsor_members")
    .select("id", { count: "exact", head: true })
    .eq("sponsor_id", sponsor.id);
  if ((count ?? 0) >= sponsor.max_uses) redirect("/login?error=sponsor_link_full");

  const guestDiscordId = `guest_${randomUUID()}`;
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .insert({
      discord_id: guestDiscordId,
      username: sponsor.name,
      display_name: sponsor.name,
      is_guest: true,
    })
    .select("id, session_version")
    .single();
  if (!account) redirect("/login?error=invalid_sponsor_link");

  await supabaseAdmin
    .from("sponsor_members")
    .insert({ sponsor_id: sponsor.id, account_id: account.id });

  await createSession(guestDiscordId, sponsor.name, null, (account.session_version as number | null) ?? 0);

  const isProduction = process.env.NODE_ENV === "production";
  const cookieStore = await cookies();
  cookieStore.set("theme", "crl6mans", {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: isProduction,
  });
  cookieStore.set("nav_layout", "sidebar", {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: isProduction,
  });

  redirect("/dashboard");
}
