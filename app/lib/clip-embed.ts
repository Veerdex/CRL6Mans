export type ClipPlatform = "youtube" | "medal" | "streamable" | "tiktok" | "twitter" | "instagram";

// tiktok/twitter/instagram have no plain iframe-embeddable player (their
// official embeds either need a third-party <script> widget or, for
// Instagram, a registered Meta developer app + API token) — so clips on
// these platforms are link-out only: no inline player, and (see clip-reset
// cron) never eligible to become Clip of the Week since that slot requires
// an autoplaying video. A best-effort thumbnail (see lib/link-preview.ts) is
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
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "instagram.com", "www.instagram.com",
];

const YOUTUBE_ID_PATTERN = /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/;
const MEDAL_ID_PATTERN = /medal\.tv\/(?:games\/[\w-]+\/)?clips\/([\w-]+)/;
const STREAMABLE_ID_PATTERN = /streamable\.com\/([\w-]+)/;

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
