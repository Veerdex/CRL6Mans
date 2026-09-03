import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { patreonAuthorizeUrl, PATREON_SUPPORTER_SCOPE } from "@/app/lib/patreon";
import { getBaseUrl } from "@/app/lib/base-url";
import { supabaseAdmin } from "@/app/lib/supabase";
import { readSimTier, topPaidTier } from "@/app/lib/patreon-sim";

// Linking an existing account, not logging in — require a session first.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) {
    const base = getBaseUrl(new URL(request.url).origin);
    return NextResponse.redirect(`${base}/login`);
  }

  // A simulated purchase stands in for the whole Patreon round trip: the
  // account gets the same field set the real callback writes, minus the tokens.
  // Leaving those null is deliberate — syncSupporterLinks only walks rows with a
  // refresh token, so the simulated link survives the cron instead of being
  // cleared as an unrefreshable one.
  const simTier = await readSimTier();
  if (simTier) {
    const tier = await topPaidTier();
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("accounts")
      .update({
        patreon_user_id: `sim-${session.userId}`,
        patreon_member_id: `sim-${session.userId}`,
        patreon_status: "active_patron",
        patreon_tier_title: tier?.title ?? simTier,
        patreon_entitled_cents: tier?.cents ?? null,
        patreon_lifetime_cents: tier?.cents ?? null,
        patreon_access_token: null,
        patreon_refresh_token: null,
        patreon_token_expires_at: null,
        patreon_connected_at: now,
        patreon_last_synced_at: now,
        updated_at: now,
      })
      .eq("discord_id", session.userId);

    const base = getBaseUrl(new URL(request.url).origin);
    return NextResponse.redirect(`${base}/dashboard/settings?patreon=connected`);
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
