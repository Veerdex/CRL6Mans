import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/app/lib/session";

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

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch {
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }
}
