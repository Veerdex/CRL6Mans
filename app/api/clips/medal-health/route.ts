import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { medalEmbedUrl } from "@/app/lib/clip-embed";

// The embed iframe is cross-origin, so the page it loads is unreadable from the
// client and its onload fires just as happily for Medal's 404 as for a player.
// The only way to know a clip will actually render is to ask Medal from the
// server, which is what this does.
//
// The signal is og:video, not the HTTP status. During Medal's outage the very
// same URL answered 404 that answers 200 today, and a live clip answers 200
// either way - but a page that cannot resolve its clip never carries an
// og:video, whether it 404s or not. ("LOL NOT FOUND" is useless for this: it
// ships inside the JS bundle on every Medal page, including working ones.)

const OG_VIDEO = /<meta[^>]+property=["']og:video["'][^>]+content=["']https?:/i;

// Medal serves the real server-rendered metadata to a browser UA; the default
// Node fetch UA is not worth finding out about.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// A Medal outage is exactly when this fetch hangs, so the timeout is the point
// of the whole thing: without it every Media page view would sit waiting on a
// site that is already down.
const PROBE_TIMEOUT_MS = 4000;

// Re-checking a healthy clip every render is pointless - clips do not stop
// existing on their own. A failing one is re-checked far sooner so the feed
// recovers on its own once Medal comes back.
const TTL_OK_MS = 10 * 60 * 1000;
const TTL_FAILING_MS = 60 * 1000;

const MAX_IDS = 24;
const CLIP_ID = /^[\w-]{1,64}$/;

type Entry = { loadable: boolean; expires: number };
const cache = new Map<string, Entry>();

async function clipLoads(id: string): Promise<boolean> {
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.loadable;

  let loadable: boolean;
  try {
    const res = await fetch(medalEmbedUrl(id), {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    loadable = OG_VIDEO.test(await res.text());
  } catch {
    loadable = false;
  }

  cache.set(id, { loadable, expires: Date.now() + (loadable ? TTL_OK_MS : TTL_FAILING_MS) });
  return loadable;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The ID goes into an outbound URL, so it is matched against the same charset
  // classifyClipUrl extracts rather than trusted - nothing else about the
  // request reaches Medal.
  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => CLIP_ID.test(s))
    .slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ error: "Missing ids" }, { status: 400 });

  const entries = await Promise.all(ids.map(async (id) => [id, await clipLoads(id)] as const));
  return NextResponse.json({ loadable: Object.fromEntries(entries) });
}
