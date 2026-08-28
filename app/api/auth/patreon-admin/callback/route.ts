import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getBaseUrl } from "@/app/lib/base-url";
import { exchangePatreonCode, fetchOwnedCampaignId } from "@/app/lib/patreon";

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
  const clearState = () => cookieStore.delete("patreon_admin_oauth_state");

  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) {
    clearState();
    return safeRedirect(request, "/dashboard");
  }

  if (patreonError || !code) {
    clearState();
    return safeRedirect(request, "/dashboard/admin?patreon_admin=cancelled");
  }

  const storedState = cookieStore.get("patreon_admin_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    clearState();
    return safeRedirect(request, "/dashboard/admin?patreon_admin=error");
  }
  clearState();

  const { PATREON_ADMIN_REDIRECT_URI } = process.env;
  if (!PATREON_ADMIN_REDIRECT_URI) {
    return safeRedirect(request, "/dashboard/admin?patreon_admin=error");
  }

  try {
    const tokens = await exchangePatreonCode(code, PATREON_ADMIN_REDIRECT_URI);
    if (!tokens) return safeRedirect(request, "/dashboard/admin?patreon_admin=error");

    const campaignId = await fetchOwnedCampaignId(tokens.accessToken);
    if (!campaignId) return safeRedirect(request, "/dashboard/admin?patreon_admin=no_campaign");

    await supabaseAdmin
      .from("league_settings")
      .update({
        patreon_campaign_access_token: tokens.accessToken,
        patreon_campaign_refresh_token: tokens.refreshToken,
        patreon_campaign_token_expires_at: tokens.expiresAt,
        patreon_campaign_id: campaignId,
        updated_at: new Date().toISOString(),
      })
      .not("id", "is", null);

    return safeRedirect(request, "/dashboard/admin?patreon_admin=connected");
  } catch (err) {
    console.error("[patreon-admin/callback] unexpected error", err);
    return safeRedirect(request, "/dashboard/admin?patreon_admin=error");
  }
}
