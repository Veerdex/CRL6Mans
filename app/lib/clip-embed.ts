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
const MEDAL_ID_PATTERN = /medal\.tv\/(?:games\/[\w-]+\/)?clips?\/([\w-]+)/;
const STREAMABLE_ID_PATTERN = /streamable\.com\/([\w-]+)/;
// Matches both the standalone clips.twitch.tv/<slug> share link and the
// twitch.tv/<channel>/clip/<slug> permalink shape (what the "Copy Link"
// button on a clip page actually gives you).
const TWITCH_ID_PATTERN = /(?:clips\.twitch\.tv\/(?:embed\?clip=)?|twitch\.tv\/\w+\/clip\/)([\w-]+)/;

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "vm.tiktok.com"]);
const TWITTER_HOSTS = new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

// Medal's player lives at the singular /clip/ path - the same URL Medal's own
// oEmbed response hands out. The plural /clips/<id> is the full clip *page*,
// which answers with x-frame-options: SAMEORIGIN and so renders as an empty box
// when framed. The game slug is not validated (any value resolves the same
// clip), so it is fixed here rather than stored per clip.
const medalEmbedUrl = (id: string) => `https://medal.tv/games/rocket-league/clip/${id}`;

// Clips submitted before that was corrected still hold the dead
// /clips/<id>/embed URL, which 301s to the SAMEORIGIN page. Repaired at render
// time in resolveClipEmbedUrl so no backfill is needed.
const MEDAL_LEGACY_EMBED_PATTERN = /medal\.tv\/clips\/([\w-]+)\/embed/;

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
      embedUrl: medalEmbedUrl(id),
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

// Every clip player is mounted as soon as its page renders, so each one has to
// be told not to start on its own: the Clip of the Week sits on Home, and a
// player that starts by itself would both hijack the page and, on the platforms
// that count a view on playback, inflate the creator's numbers for people who
// never chose to watch. Letting the platform's own player render is what puts a
// real thumbnail there — each one draws its own poster frame, including the
// signed, expiring ones we could never store ourselves.
//
// Only Streamable is verifiably off by default (its embed ships the <video> as
// preload="none" with no autoplay attribute, so not a byte of media moves until
// a click). Twitch documents the opposite default, and YouTube's and Medal's
// embeds are JS shells that read the param at runtime, so the flag is passed
// explicitly on all four rather than trusting a default to stay put.
const AUTOPLAY_OFF: Partial<Record<ClipPlatform, string>> = {
  youtube: "autoplay=0",
  streamable: "autoplay=0",
  medal: "autoplay=false",
  twitch: "autoplay=false",
};

// Turns a stored embed_url into the src an <iframe> can actually use.
//
// Twitch's embed API rejects a clip iframe unless its `parent` query param
// matches the actual embedding page's hostname, so unlike the other platforms'
// embed_url this can't be precomputed once at submission time. The hostname is
// an explicit argument (rather than read from `window.location` here) so this
// renders identically on the server and on the client's first paint — callers
// fill in the real hostname only after mount, which avoids a hydration
// mismatch. Called from both clip-of-week.tsx and media-feed.tsx so the two
// stay consistent.
export function resolveClipEmbedUrl(clip: { platform: ClipPlatform; embed_url: string }, host: string | null = null): string {
  let url = clip.embed_url;

  if (clip.platform === "medal") {
    const legacyId = url.match(MEDAL_LEGACY_EMBED_PATTERN)?.[1];
    if (legacyId) url = medalEmbedUrl(legacyId);
  }

  const params = [AUTOPLAY_OFF[clip.platform]];
  if (clip.platform === "twitch" && host) params.push(`parent=${host}`);

  const query = params.filter(Boolean).join("&");
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}
