import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase";
import { sendChannelMessage } from "@/app/lib/discord-api";
import { mostRecentSundayMidnightPacific } from "@/app/lib/clip-schedule";

export const runtime = "nodejs";

// Hit every minute by an external pinger (see the pinger note in CLAUDE.md's
// cron section) so both the per-clip expiry sweep and the weekly crowning
// fire close to the instant they're due, not just on Vercel's daily fallback
// schedule.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const fired: string[] = [];

  // Archives clips whose individual guaranteed-lifetime window (see
  // computeClipExpiry) has elapsed. Runs on every invocation, independent of
  // the weekly crowning below — expiries are staggered per-clip (each clip
  // submitted on a different day expires on a different day), not aligned to
  // a single weekly sweep.
  const { data: expiredClips } = await supabaseAdmin
    .from("clips")
    .update({ archived_at: now.toISOString() })
    .is("archived_at", null)
    .lte("expires_at", now.toISOString())
    .select("id");
  if (expiredClips?.length) fired.push(`expired:${expiredClips.length}`);

  const boundary = mostRecentSundayMidnightPacific(now);

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("last_clip_reset_at, clips_channel_id")
    .single();
  const lastResetAt = settings?.last_clip_reset_at ? new Date(settings.last_clip_reset_at as string) : null;

  // First-ever run (or a fresh setup): seed the baseline to the boundary that
  // already passed instead of treating it as immediately due. Without this, a
  // null last_clip_reset_at would crown on the very next cron tick regardless
  // of how recently clips were submitted, rather than waiting for the next
  // real Sunday.
  if (!lastResetAt) {
    await supabaseAdmin
      .from("league_settings")
      .update({ last_clip_reset_at: boundary.toISOString() })
      .not("id", "is", null);
    return NextResponse.json({ ok: true, fired });
  }

  if (lastResetAt >= boundary) {
    return NextResponse.json({ ok: true, fired });
  }

  // Link-only platforms (tiktok/twitter/instagram) have no autoplaying embed, so
  // they're excluded from Clip of the Week even if they're the most-liked
  // active clip.
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
    // Only the winner is archived here — every other still-active clip keeps
    // running out its own guaranteed-lifetime window instead of being swept
    // out just because a weekly winner was picked.
    await supabaseAdmin
      .from("clips")
      .update({ archived_at: now.toISOString() })
      .eq("id", winner.id);
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
