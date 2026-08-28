import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { getBaseUrl } from "@/app/lib/base-url";
import { patreonAuthorizeUrl, PATREON_CAMPAIGN_OWNER_SCOPE } from "@/app/lib/patreon";

// One-time, director+-only connection so the admin Data tab can read the full
// campaign member list, not just the players who linked their own account.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  const base = getBaseUrl(new URL(request.url).origin);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) {
    return NextResponse.redirect(`${base}/dashboard`);
  }

  const { PATREON_CLIENT_ID, PATREON_ADMIN_REDIRECT_URI } = process.env;
  if (!PATREON_CLIENT_ID || !PATREON_ADMIN_REDIRECT_URI) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(
    patreonAuthorizeUrl(PATREON_CLIENT_ID, PATREON_ADMIN_REDIRECT_URI, state, PATREON_CAMPAIGN_OWNER_SCOPE)
  );
  response.cookies.set("patreon_admin_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
