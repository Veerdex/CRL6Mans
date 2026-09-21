import { NextResponse } from "next/server";
import { syncDiscordIdentities } from "@/app/lib/discord-identity-sync";

export const runtime = "nodejs";
// One sequential Discord lookup per account, spaced to stay clear of the rate
// limiter, so the whole sweep scales with roster size.
export const maxDuration = 300;

// Daily fallback schedule only — a username or avatar being a day stale is
// harmless, so this is not on the external per-minute pinger list (see
// CLAUDE.md's cron section).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncDiscordIdentities();

  return NextResponse.json({ ok: true, ...result });
}
