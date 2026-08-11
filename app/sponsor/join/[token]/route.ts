import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getBaseUrl } from "@/app/lib/base-url";

// Entry point for a sponsor invite link. Validates the token, stashes it in a
// short-lived cookie, then hands off to the normal Discord OAuth flow — the
// callback route reads the cookie and links the resulting account to the
// sponsor. No parallel auth system.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const base = getBaseUrl(new URL(request.url).origin);

  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("id, max_uses")
    .eq("invite_token", token)
    .eq("status", "active")
    .single();
  if (!sponsor) return NextResponse.redirect(`${base}/login?error=invalid_sponsor_link`);

  const { count } = await supabaseAdmin
    .from("sponsor_members")
    .select("id", { count: "exact", head: true })
    .eq("sponsor_id", sponsor.id);
  if ((count ?? 0) >= sponsor.max_uses) return NextResponse.redirect(`${base}/login?error=sponsor_link_full`);

  const cookieStore = await cookies();
  cookieStore.set("sponsor_invite_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    sameSite: "lax",
    path: "/",
  });

  return NextResponse.redirect(`${base}/api/auth/discord`);
}
