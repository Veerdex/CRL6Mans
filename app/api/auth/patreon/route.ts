import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { patreonAuthorizeUrl, PATREON_SUPPORTER_SCOPE } from "@/app/lib/patreon";
import { getBaseUrl } from "@/app/lib/base-url";

// Linking an existing account, not logging in — require a session first.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) {
    const base = getBaseUrl(new URL(request.url).origin);
    return NextResponse.redirect(`${base}/login`);
  }

  const { PATREON_CLIENT_ID, PATREON_REDIRECT_URI } = process.env;
  if (!PATREON_CLIENT_ID || !PATREON_REDIRECT_URI) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const state = crypto.randomUUID();

  // Distinct cookie name from Discord's oauth_state so a concurrent Discord
  // login can't clobber this flow's state.
  const response = NextResponse.redirect(
    patreonAuthorizeUrl(PATREON_CLIENT_ID, PATREON_REDIRECT_URI, state, PATREON_SUPPORTER_SCOPE)
  );
  response.cookies.set("patreon_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
