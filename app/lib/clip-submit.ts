import { supabaseAdmin } from "./supabase";
import { sendChannelMessage } from "./discord-api";
import { classifyClipUrl, isLinkOnlyPlatform, type ClipPlatform } from "./clip-embed";
import { fetchClipThumbnail } from "./link-preview";
import { computeClipExpiry } from "./clip-schedule";

export const MAX_ACTIVE_SUBMISSIONS_PER_PLAYER = 5;
export const MAX_TITLE_LENGTH = 150;

export const INVALID_CLIP_URL_MESSAGE =
  "Link must be a valid YouTube, medal.tv, Streamable, Twitch, TikTok, X/Twitter, or Instagram URL.";

export type CreatedClip = {
  id: string;
  title: string;
  url: string;
  platform: ClipPlatform;
};

// The one place a clip row is written. The Media tab's submit form and the
// bot's /postclip both go through it so the URL rules, the per-player cap, the
// dedup message and the expiry can't drift apart between the two entry points.
// Every failure returns before the insert, so a rejected clip leaves no trace.
// The clips-channel message both of them post is announceClip below, which lives
// here for the same reason.
export async function createClip(
  playerId: string,
  title: string,
  url: string
): Promise<{ clip: CreatedClip; error?: undefined } | { clip?: undefined; error: string }> {
  const trimmedTitle = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!trimmedTitle) return { error: "Title is required." };

  const classified = classifyClipUrl(url);
  if (!classified) return { error: INVALID_CLIP_URL_MESSAGE };

  const { count } = await supabaseAdmin
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .is("archived_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_SUBMISSIONS_PER_PLAYER) {
    return { error: `You can only have ${MAX_ACTIVE_SUBMISSIONS_PER_PLAYER} active submissions at a time.` };
  }

  const thumbnailUrl = isLinkOnlyPlatform(classified.platform)
    ? await fetchClipThumbnail(classified.platform, classified.normalizedUrl)
    : null;

  const { data, error } = await supabaseAdmin
    .from("clips")
    .insert({
      player_id: playerId,
      title: trimmedTitle,
      url: classified.normalizedUrl,
      normalized_url: classified.normalizedUrl,
      platform: classified.platform,
      embed_url: classified.embedUrl,
      thumbnail_url: thumbnailUrl,
      expires_at: computeClipExpiry(new Date()).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "This clip has already been submitted this week." };
    return { error: error.message };
  }

  return {
    clip: {
      id: data.id as string,
      title: trimmedTitle,
      url: classified.normalizedUrl,
      platform: classified.platform,
    },
  };
}

export async function clipsChannelId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("clips_channel_id")
    .single();
  return (data?.clips_channel_id as string | null) ?? null;
}

// Plain content with the URL last and on its own line, so Discord renders its
// own player for it — the Clip of the Week crowning deliberately uses an embed
// instead. The title is player-typed, so the submitter's own mention is the only
// one let through, or a title of "@everyone" pings the server through the bot.
// That guard is owned here rather than passed in so neither entry point can
// forget it. Returns whether the message landed; the caller decides whether a
// failure is worth surfacing.
export async function announceClip(
  channelId: string,
  clip: CreatedClip,
  discordUserId: string,
): Promise<boolean> {
  const posted = await sendChannelMessage(
    channelId,
    `🎬 **${clip.title}** — <@${discordUserId}>\n${clip.url}`,
    undefined,
    { parse: [], users: [discordUserId] }
  );
  return posted !== null;
}
