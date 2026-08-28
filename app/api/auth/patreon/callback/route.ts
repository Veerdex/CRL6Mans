import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getBaseUrl } from "@/app/lib/base-url";
import { exchangePatreonCode, fetchPatreonIdentity } from "@/app/lib/patreon";

function safeRedirect(request: NextRequest, path: string) {
  const base = getBaseUrl(new URL(request.url).origin);
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const patreonError = searchParams.get("error");

  const cookieStore = await cookies();
  const clearState = () => cookieStore.delete("patreon_oauth_state");

  // The user could have logged out mid-flow — re-check rather than trust the
  // state cookie alone, so the link never attaches to nothing.
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) {
    clearState();
    return safeRedirect(request, "/login");
  }

  if (patreonError || !code) {
    clearState();
    return safeRedirect(request, "/dashboard/settings?patreon=cancelled");
  }

  const storedState = cookieStore.get("patreon_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    clearState();
    return safeRedirect(request, "/dashboard/settings?patreon=error");
  }
  clearState();

  const { PATREON_REDIRECT_URI } = process.env;
  if (!PATREON_REDIRECT_URI) {
    return safeRedirect(request, "/dashboard/settings?patreon=error");
  }

  try {
    const tokens = await exchangePatreonCode(code, PATREON_REDIRECT_URI);
    if (!tokens) return safeRedirect(request, "/dashboard/settings?patreon=error");

    const identity = await fetchPatreonIdentity(tokens.accessToken);
    if (!identity) return safeRedirect(request, "/dashboard/settings?patreon=error");

    await supabaseAdmin
      .from("accounts")
      .update({
        patreon_user_id: identity.patreonUserId,
        patreon_member_id: identity.memberId,
        patreon_status: identity.status,
        patreon_tier_title: identity.tierTitle,
        patreon_entitled_cents: identity.entitledCents,
        patreon_lifetime_cents: identity.lifetimeCents,
        patreon_access_token: tokens.accessToken,
        patreon_refresh_token: tokens.refreshToken,
        patreon_token_expires_at: tokens.expiresAt,
        patreon_connected_at: new Date().toISOString(),
        patreon_last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("discord_id", session.userId);

    return safeRedirect(request, "/dashboard/settings?patreon=connected");
  } catch (err) {
    console.error("[patreon/callback] unexpected error", err);
    return safeRedirect(request, "/dashboard/settings?patreon=error");
  }
}
