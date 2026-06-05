import { NextResponse } from "next/server";

export async function GET() {
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state,
  });

  const response = NextResponse.redirect(
    `https://discord.com/oauth2/authorize?${params}`
  );
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
