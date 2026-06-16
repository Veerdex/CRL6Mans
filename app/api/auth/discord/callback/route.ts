import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const discordError = searchParams.get("error");

  const cookieStore = await cookies();

  const clearState = () => cookieStore.delete("oauth_state");

  if (discordError) {
    clearState();
    return NextResponse.redirect(new URL("/login?error=cancelled", request.url));
  }

  if (!code) {
    clearState();
    return NextResponse.redirect(new URL("/login?error=cancelled", request.url));
  }

  const storedState = cookieStore.get("oauth_state")?.value;
  if (!storedState || storedState !== state) {
    clearState();
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }

  clearState();

  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
    }

    const { access_token } = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
    }

    const user = await userRes.json();

    if (!user.id || !user.username) {
      return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
    }

    await createSession(user.id, user.username, user.avatar ?? null);

    // Keep avatar in sync on every login.
    await supabaseAdmin
      .from("players")
      .update({ avatar: user.avatar ?? null, updated_at: new Date().toISOString() })
      .eq("discord_id", user.id);

    // Mirror the player's saved theme + nav layout into cookies for no-flash SSR.
    const { data: player } = await supabaseAdmin
      .from("players").select("theme, nav_layout").eq("discord_id", user.id).single();
    const saved = player?.theme;
    const theme = saved === "dark" || saved === "light" || saved === "crl6mans" ? saved : "crl6mans";
    cookieStore.set("theme", theme, {
      path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
    });
    const navLayout = player?.nav_layout === "topbar" ? "topbar" : "sidebar";
    cookieStore.set("nav_layout", navLayout, {
      path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
    });

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (err) {
    console.error("[discord/callback] unexpected error", err);
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }
}
