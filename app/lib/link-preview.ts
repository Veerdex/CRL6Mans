import type { ClipPlatform } from "@/app/lib/clip-embed";

const FETCH_TIMEOUT_MS = 4000;
const PREVIEW_USER_AGENT = "CRL6MansLinkPreview/1.0 (+link preview fetcher)";

type TikTokOEmbedResponse = { thumbnail_url?: string };

function extractOgImage(html: string): string | null {
  const match =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return match?.[1] ?? null;
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

// Best-effort link-preview thumbnail for link-only platforms (tiktok/twitter/
// instagram). Never throws — any network error, timeout, non-2xx response, or
// missing tag just resolves to null, and the caller falls back to a plain
// link-out card with no thumbnail.
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

  if (platform === "twitter" || platform === "instagram") {
    const res = await timedFetch(normalizedUrl);
    if (!res?.ok) return null;
    try {
      return extractOgImage(await res.text());
    } catch {
      return null;
    }
  }

  return null;
}
