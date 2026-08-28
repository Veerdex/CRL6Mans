import { NextResponse } from "next/server";
import { syncSupporterLinks, getFreshCampaignAccessToken } from "@/app/lib/patreon-sync";

export const runtime = "nodejs";

// Daily fallback schedule only — patron status doesn't need per-minute
// freshness, so this is not on the external per-minute pinger list (see
// CLAUDE.md's cron section).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supporters = await syncSupporterLinks();

  // Keeps the campaign-owner token from going stale between admin Data tab
  // views, which fetch campaign members live using this same token.
  const campaign = await getFreshCampaignAccessToken();

  return NextResponse.json({
    ok: true,
    supporters,
    campaignTokenFresh: campaign !== null,
  });
}
