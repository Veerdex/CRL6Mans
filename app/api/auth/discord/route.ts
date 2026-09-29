import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const state = crypto.randomUUID();

  // A player who already granted `identify` doesn't need to see the authorize
  // screen again — prompt=none makes the per-browser sign-in a silent bounce.
  // Discord answers with an error rather than a prompt when it can't be silent
  // (never authorized, authorization revoked, or not signed in to Discord in
  // this browser), so the callback retries with ?consent=1 and the cookie below
  // is how it knows this attempt was the silent one.
  const forceConsent = request.nextUrl.searchParams.get("consent") === "1";

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state,
  });
  if (!forceConsent) params.set("prompt", "none");

  const response = NextResponse.redirect(
    `https://discord.com/oauth2/authorize?${params}`
  );
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    sameSite: "lax" as const,
    path: "/",
  };
  response.cookies.set("oauth_state", state, cookieOptions);
  if (forceConsent) response.cookies.delete("oauth_silent");
  else response.cookies.set("oauth_silent", "1", cookieOptions);
  return response;
}
