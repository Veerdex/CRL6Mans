import type { ClipPlatform } from "@/app/lib/clip-embed";

const FETCH_TIMEOUT_MS = 4000;
const PREVIEW_USER_AGENT = "CRL6MansLinkPreview/1.0 (+link preview fetcher)";

type TikTokOEmbedResponse = { thumbnail_url?: string };

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

// An og:image URL arrives HTML-escaped, so a query string comes back with
// "&amp;" between its params. Medal's thumbnails are signed and carry several,
// and a param literally named "amp;width" is at best ignored and at worst
// breaks signature validation.
function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|#39|lt|gt);/g, (entity) => HTML_ENTITIES[entity]);
}

function extractOgImage(html: string): string | null {
  const match =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return match ? decodeEntities(match[1]) : null;
}

async function timedFetch(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "User-Agent": PREVIEW_USER_AGENT } });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Best-effort still image for a clip, scraped from the clip page. Never throws —
// any network error, timeout, non-2xx response, or missing tag just resolves to
// null, and the caller renders without an image.
//
// Two callers, wanting it for opposite reasons. The link-only platforms
// (tiktok/twitter/instagram) have no embeddable player at all, so clip-submit
// fetches one at submission time to give the link-out card a face. The
// embeddable ones (medal/streamable/twitch) need it only for the Discord Clip of
// the Week announcement, where nothing can mount a player — the site itself
// renders their real iframes and gets a genuine poster frame for free.
//
// **That second case must be fetched at crowning time, not submission time.**
// Medal's og:image is a signed CDN URL that expires in about a day (the bare
// URL 403s without the signature), and a clip can be submitted more than a week
// before it wins. Discord proxies the image when the message is posted, so a
// fresh URL at crowning is what makes the thumbnail stick.
//
// Medal's oEmbed endpoint is gone (410), hence scraping the page for all of
// them rather than one oEmbed path per platform.
export async function fetchClipThumbnail(platform: ClipPlatform, normalizedUrl: string): Promise<string | null> {
  if (platform === "tiktok") {
    const res = await timedFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(normalizedUrl)}`);
    if (!res?.ok) return null;
    try {
      const data = (await res.json()) as TikTokOEmbedResponse;
      return data.thumbnail_url ?? null;
    } catch {
      return null;
    }
  }

  const res = await timedFetch(normalizedUrl);
  if (!res?.ok) return null;
  try {
    return extractOgImage(await res.text());
  } catch {
    return null;
  }
}
