export type ClipPlatform = "youtube" | "medal" | "streamable" | "twitch" | "tiktok" | "twitter" | "instagram";

// tiktok/twitter/instagram have no plain iframe-embeddable player (their
// official embeds either need a third-party <script> widget or, for
// Instagram, a registered Meta developer app + API token) — so clips on
// these platforms are link-out only: no inline player, and (see clip-reset
// cron) never eligible to become Clip of the Week since that slot renders a
// player. A best-effort thumbnail (see lib/link-preview.ts) is
// fetched at submission time so the link-out card isn't just bare text.
export const LINK_ONLY_PLATFORMS: ReadonlySet<ClipPlatform> = new Set(["tiktok", "twitter", "instagram"]);

export function isLinkOnlyPlatform(platform: ClipPlatform): boolean {
  return LINK_ONLY_PLATFORMS.has(platform);
}

// Kept as one exported array so a new source is a one-line addition rather
// than a change scattered across validation logic.
export const ALLOWED_CLIP_HOSTS = [
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "medal.tv", "www.medal.tv",
  "streamable.com",
  "twitch.tv", "www.twitch.tv", "m.twitch.tv", "clips.twitch.tv",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "instagram.com", "www.instagram.com",
];

const YOUTUBE_ID_PATTERN = /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/;
const MEDAL_ID_PATTERN = /medal\.tv\/(?:games\/[\w-]+\/)?clips\/([\w-]+)/;
const STREAMABLE_ID_PATTERN = /streamable\.com\/([\w-]+)/;
// Matches both the standalone clips.twitch.tv/<slug> share link and the
// twitch.tv/<channel>/clip/<slug> permalink shape (what the "Copy Link"
// button on a clip page actually gives you).
const TWITCH_ID_PATTERN = /(?:clips\.twitch\.tv\/(?:embed\?clip=)?|twitch\.tv\/\w+\/clip\/)([\w-]+)/;

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "vm.tiktok.com"]);
const TWITTER_HOSTS = new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

export type ClassifiedClip = {
  platform: ClipPlatform;
  normalizedUrl: string;
  embedUrl: string;
};

// Validates a submitted clip URL and derives everything rendering/dedup need
// up front, so no URL-parsing logic is needed at render time. Returns null on
// any validation failure (unparsable URL, non-https, disallowed host, or a
// host we allow but couldn't extract a clip ID from).
export function classifyClipUrl(rawUrl: string): ClassifiedClip | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!ALLOWED_CLIP_HOSTS.includes(parsed.hostname)) return null;

  const href = parsed.toString();

  const youtubeMatch = href.match(YOUTUBE_ID_PATTERN);
  if (youtubeMatch) {
    const id = youtubeMatch[1];
    return {
      platform: "youtube",
      normalizedUrl: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}`,
    };
  }

  const medalMatch = href.match(MEDAL_ID_PATTERN);
  if (medalMatch) {
    const id = medalMatch[1];
    return {
      platform: "medal",
      normalizedUrl: `https://medal.tv/clips/${id}`,
      embedUrl: `https://medal.tv/clips/${id}/embed`,
    };
  }

  const streamableMatch = href.match(STREAMABLE_ID_PATTERN);
  if (streamableMatch) {
    const id = streamableMatch[1];
    return {
      platform: "streamable",
      normalizedUrl: `https://streamable.com/${id}`,
      embedUrl: `https://streamable.com/e/${id}`,
    };
  }

  const twitchMatch = href.match(TWITCH_ID_PATTERN);
  if (twitchMatch) {
    const id = twitchMatch[1];
    return {
      platform: "twitch",
      normalizedUrl: `https://clips.twitch.tv/${id}`,
      // Twitch requires a `parent=<embedding hostname>` param that it
      // validates server-side, and that hostname differs between local dev
      // and production — so it can't be baked in here. resolveClipEmbedUrl
      // appends it at render time instead.
      embedUrl: `https://clips.twitch.tv/embed?clip=${id}`,
    };
  }

  // Link-only platforms (no iframe-embeddable player) — normalize to a bare
  // origin + path (drop query/fragment, e.g. tracking params) so the same
  // post can't be resubmitted this week under a slightly different URL.
  // embedUrl is unused for these (rendered as a link-out, not an <iframe>).
  const path = parsed.pathname.replace(/\/+$/, "");
  if (TIKTOK_HOSTS.has(parsed.hostname)) {
    const normalizedUrl = `https://${parsed.hostname}${path}`;
    return { platform: "tiktok", normalizedUrl, embedUrl: normalizedUrl };
  }
  if (TWITTER_HOSTS.has(parsed.hostname)) {
    const normalizedUrl = `https://x.com${path}`;
    return { platform: "twitter", normalizedUrl, embedUrl: normalizedUrl };
  }
  if (INSTAGRAM_HOSTS.has(parsed.hostname)) {
    const normalizedUrl = `https://www.instagram.com${path}`;
    return { platform: "instagram", normalizedUrl, embedUrl: normalizedUrl };
  }

  return null;
}

// Twitch's embed API rejects a clip iframe unless its `parent` query param
// matches the actual embedding page's hostname, so unlike the other
// platforms' embed_url this can't be precomputed once at submission time.
// Takes the hostname as an explicit argument (rather than reading
// `window.location` itself) so it renders identically on the server and on
// the client's first paint — callers add the real hostname client-side only
// after mount (see useResolvedEmbedUrl below), which avoids a hydration
// mismatch. Called from both clip-of-week.tsx and media-feed.tsx so the two
// stay consistent.
export function resolveClipEmbedUrl(clip: { platform: ClipPlatform; embed_url: string }, host: string | null = null): string {
  if (clip.platform !== "twitch") return clip.embed_url;
  return host ? `${clip.embed_url}&parent=${host}` : clip.embed_url;
}

// Poster frame for the Clip of the Week facade, derived from data we already
// have so it works for clips submitted before the facade existed.
//
// Only YouTube has a thumbnail URL you can compute from the video ID. Twitch and
// Medal both answer og:image with a generic site logo rather than a frame, and
// Streamable's image CDN 403s unauthenticated requests, so there is nothing to
// derive or scrape for those three - they fall back to stored thumbnail_url
// (only ever set for the link-only platforms) and then to a plain play button.
//
// hqdefault is 480x360: a 480x270 frame letterboxed with 45px bars. Drawn
// object-cover in an aspect-video box those bars crop away exactly, which is why
// it beats maxresdefault (404s on low-res uploads) and mqdefault (320x180).
export function clipPosterUrl(clip: {
  platform: ClipPlatform;
  embed_url: string;
  thumbnail_url?: string | null;
}): string | null {
  if (clip.platform === "youtube") {
    const id = clip.embed_url.match(YOUTUBE_ID_PATTERN)?.[1];
    if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  return clip.thumbnail_url ?? null;
}
