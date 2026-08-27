import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase";
import { sendChannelMessage } from "@/app/lib/discord-api";

export const runtime = "nodejs";

// How far America/Los_Angeles is behind UTC at a given instant, in ms
// (negative — e.g. -7h during PDT, -8h during PST). Derived by formatting the
// instant into Pacific wall-clock fields, then comparing that (interpreted as
// UTC) against the instant itself.
function pacificOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

// Most recent Sunday 00:00 America/Los_Angeles, as a UTC instant. Computes
// the offset separately for "now" and for the target Sunday (not just once)
// so a DST transition falling inside the lookback window doesn't shift the
// boundary by an hour.
function mostRecentSundayMidnightPacific(now: Date): Date {
  const nowOffset = pacificOffsetMs(now);
  const nowPacificFields = new Date(now.getTime() + nowOffset);
  const y = nowPacificFields.getUTCFullYear();
  const mo = nowPacificFields.getUTCMonth();
  const d = nowPacificFields.getUTCDate();
  const daysSinceSunday = nowPacificFields.getUTCDay();

  // A calendar date for the target Sunday, then a same-day noon-UTC instant
  // (safely clear of any Pacific date-boundary rollover) to derive that day's
  // own offset.
  const sundayDateOnly = new Date(Date.UTC(y, mo, d - daysSinceSunday));
  const sy = sundayDateOnly.getUTCFullYear();
  const smo = sundayDateOnly.getUTCMonth();
  const sd = sundayDateOnly.getUTCDate();
  const sundayNoonUtc = new Date(Date.UTC(sy, smo, sd, 12, 0, 0));
  const sundayOffset = pacificOffsetMs(sundayNoonUtc);

  return new Date(Date.UTC(sy, smo, sd, 0, 0, 0) - sundayOffset);
}

// Hit every minute by an external pinger (see the pinger note in CLAUDE.md's
// cron section) so the crowning fires close to the instant it's due, not just
// on Vercel's daily fallback schedule.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const boundary = mostRecentSundayMidnightPacific(now);

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("last_clip_reset_at, clips_channel_id")
    .single();
  const lastResetAt = settings?.last_clip_reset_at ? new Date(settings.last_clip_reset_at as string) : null;

  if (lastResetAt && lastResetAt >= boundary) {
    return NextResponse.json({ ok: true, fired: [] });
  }

  const fired: string[] = [];

  // Link-only platforms (tiktok/twitter/instagram) have no autoplaying embed, so
  // they're excluded from Clip of the Week even if they're the most-liked
  // active clip — they still get archived like everything else below.
  const { data: winner } = await supabaseAdmin
    .from("clips")
    .select("id, title, url, likes_count")
    .is("archived_at", null)
    .in("platform", ["youtube", "medal", "streamable"])
    .order("likes_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (winner) {
    await supabaseAdmin
      .from("clips")
      .update({ archived_at: now.toISOString() })
      .is("archived_at", null);
    await supabaseAdmin
      .from("league_settings")
      .update({ clip_of_week_id: winner.id })
      .not("id", "is", null);
    fired.push(`crowned:${winner.title}`);

    const channelId = settings?.clips_channel_id as string | null;
    if (channelId) {
      const likes = winner.likes_count as number;
      await sendChannelMessage(channelId, "", [{
        title: winner.title as string,
        url: winner.url as string,
        description: `${likes} like${likes === 1 ? "" : "s"}`,
      }]).catch(() => {});
    }
  }

  await supabaseAdmin
    .from("league_settings")
    .update({ last_clip_reset_at: now.toISOString() })
    .not("id", "is", null);

  return NextResponse.json({ ok: true, fired });
}
