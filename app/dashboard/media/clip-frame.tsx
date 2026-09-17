"use client";

import { useEffect, useState } from "react";
import { medalClipId, resolveClipEmbedUrl, type ClipPlatform } from "@/app/lib/clip-embed";

type FrameClip = { platform: ClipPlatform; url: string; embed_url: string };

// Medal's embed path is the one shape of theirs that sends no x-frame-options,
// so when a clip will not resolve their branded 404 renders *inside* the card
// rather than being blocked. Sitting next to a delete button, that reads as a
// dead clip - during Medal's outage it made a perfectly live clip look removed.
// This asks our own server whether the clip resolves and says so plainly
// instead.
//
// Deliberately only Medal: the other platforms either refuse to frame at all or
// draw their own in-player error, so there is nothing to catch.
export function ClipFrame({ clip, host, eager = false }: { clip: FrameClip; host: string | null; eager?: boolean }) {
  const medalId = clip.platform === "medal" ? medalClipId(clip.embed_url) : null;
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!medalId) return;
    let cancelled = false;
    fetch(`/api/clips/medal-health?ids=${encodeURIComponent(medalId)}`)
      .then((res) => (res.ok ? res.json() : null))
      // Only an explicit false hides the player. If our own check is broken or
      // unreachable the iframe stays exactly as it was - a health check that
      // fails must not be what takes working clips off the feed.
      .then((data) => {
        if (!cancelled && data?.loadable?.[medalId] === false) setUnavailable(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [medalId]);

  if (unavailable) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-6 text-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-zinc-600">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
        </svg>
        <p className="text-sm font-medium text-zinc-300">This clip isn&apos;t loading</p>
        {/* Both causes are named because our check genuinely cannot tell them
            apart: a removed clip and a Medal outage look identical from here. */}
        <p className="text-xs text-zinc-500">Medal may be down, or the clip may have been removed.</p>
        <a
          href={clip.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
        >
          Try it on Medal ↗
        </a>
      </div>
    );
  }

  return (
    <iframe
      src={resolveClipEmbedUrl(clip, host)}
      className="w-full h-full"
      loading={eager ? undefined : "lazy"}
      allowFullScreen
    />
  );
}
