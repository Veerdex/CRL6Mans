import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase";
import { sendChannelMessage } from "@/app/lib/discord-api";
import { clipOfWeekEmbed, clipOfWeekPing } from "@/app/lib/clip-embeds";
import { clipPreviewImageUrl } from "@/app/lib/clip-embed";
import { mostRecentSundayMidnightPacific } from "@/app/lib/clip-schedule";
import { stampCronHeartbeat } from "@/app/lib/cron-heartbeat";
import { deleteExpiredNotifications } from "@/app/lib/notifications";

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

  // Ahead of the three separate return paths below, so a run that exits early
  // still records that the pinger reached us.
  await stampCronHeartbeat("clipreset");

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

  // Same shape of sweep, so it rides along here rather than earning its own cron.
  // Notifications are deleted outright rather than archived — nothing reads a
  // notification past its expiry, unlike a clip, which stays visible in Media's
  // past-weeks view.
  const purged = await deleteExpiredNotifications().catch(() => 0);
  if (purged) fired.push(`notifications_purged:${purged}`);

  const boundary = mostRecentSundayMidnightPacific(now);

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("last_clip_reset_at, clips_channel_id, registered_role_id")
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
    .select("id, title, url, thumbnail_url, likes_count, players!clips_player_id_fkey(username, display_name)")
    .is("archived_at", null)
    .in("platform", ["youtube", "medal", "streamable", "twitch"])
    .order("likes_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (winner) {
    // Read before the winner's own update below, so the running count doesn't
    // see the row it is about to number.
    //
    // An error here means the column isn't there yet (see
    // scripts/clip-of-week-number-migration.sql). That degrades to the
    // unnumbered announcement this used to post rather than taking the
    // crowning down with it — writing a column Postgres doesn't have would
    // fail the same update that archives the winner.
    const { data: lastCrowned, error: numberingError } = await supabaseAdmin
      .from("clips")
      .select("clip_of_week_number")
      .not("clip_of_week_number", "is", null)
      .order("clip_of_week_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const weekNumber = numberingError
      ? null
      : ((lastCrowned?.clip_of_week_number as number | undefined) ?? 0) + 1;

    // Only the winner is archived here — every other still-active clip keeps
    // running out its own guaranteed-lifetime window instead of being swept
    // out just because a weekly winner was picked.
    await supabaseAdmin
      .from("clips")
      .update({
        archived_at: now.toISOString(),
        ...(weekNumber === null ? {} : { clip_of_week_number: weekNumber }),
      })
      .eq("id", winner.id);
    await supabaseAdmin
      .from("league_settings")
      .update({ clip_of_week_id: winner.id })
      .not("id", "is", null);
    fired.push(`crowned:${weekNumber === null ? "unnumbered" : `week${weekNumber}`}:${winner.title}`);

    const channelId = settings?.clips_channel_id as string | null;
    if (channelId) {
      // The submitter's row is absent when their player row was deleted
      // (clips.player_id is `on delete set null`). Supabase types an embedded
      // to-one relation as an array, hence the unwrap.
      const submitter = (Array.isArray(winner.players) ? winner.players[0] : winner.players) as
        | { username: string | null; display_name: string | null }
        | null
        | undefined;
      const roleId = (settings?.registered_role_id as string | null) ?? null;

      const embed = clipOfWeekEmbed({
        weekNumber,
        title: winner.title as string,
        url: winner.url as string,
        likes: winner.likes_count as number,
        submitterName: submitter?.display_name ?? submitter?.username ?? null,
        imageUrl: clipPreviewImageUrl({
          url: winner.url as string,
          thumbnail_url: (winner.thumbnail_url as string | null) ?? null,
        }),
      });

      // `parse: []` with an explicit roles list is what keeps the ping to the
      // registered role only: without it a clip title reading "@everyone"
      // would ping the server through the bot.
      await sendChannelMessage(
        channelId,
        clipOfWeekPing(roleId),
        [embed],
        { parse: [], ...(roleId ? { roles: [roleId] } : {}) },
      ).catch(() => {});
    }
  }

  await supabaseAdmin
    .from("league_settings")
    .update({ last_clip_reset_at: now.toISOString() })
    .not("id", "is", null);

  return NextResponse.json({ ok: true, fired });
}
