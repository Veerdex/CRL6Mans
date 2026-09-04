"use client";

import { useEffect, useState, useTransition } from "react";
import { clearClipOfWeek } from "@/app/dashboard/media/actions";
import { ClipConfirmModal } from "@/app/dashboard/media/clip-confirm-modal";
import { PlayerName } from "@/app/dashboard/player-name";
import { clipPosterUrl, resolveClipEmbedUrl } from "@/app/lib/clip-embed";
import type { Clip } from "@/app/dashboard/media/media-feed";

// Only built once the viewer clicks play, so autoplay here means "start on
// mount" rather than "start on page load", and the click is the user gesture
// that lets it start with sound instead of muted. Twitch's embed_url already
// carries a query string, hence & rather than ? for that one.
function clipOfWeekEmbedSrc(clip: Clip, host: string | null): string {
  const base = resolveClipEmbedUrl(clip, host);
  if (clip.platform === "youtube") return `${base}?autoplay=1`;
  if (clip.platform === "streamable") return `${base}?autoplay=1`;
  if (clip.platform === "medal") return `${base}?autoplay=true`;
  if (clip.platform === "twitch") return `${base}&autoplay=true&muted=false`;
  return base;
}

export function ClipOfWeek({ clip, isModerator }: { clip: Clip | null; isModerator: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The featured clip sits on Home as well as Media, so an iframe here would
  // load a player - and, on the platforms that count them, register a view -
  // for every visitor on every visit, whether or not anyone watched. Starting
  // false means the server renders a poster and the real player is built only
  // when someone asks for it.
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Twitch embeds need the page's real hostname, but reading it during the
  // initial render would differ between server and client and cause a
  // hydration mismatch — so it starts null (matching the server) and is
  // filled in after mount.
  const [host, setHost] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of window.location, not an ongoing sync
  useEffect(() => setHost(window.location.hostname), []);

  if (!clip) return null;

  const poster = clipPosterUrl(clip);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await clearClipOfWeek();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
    });
  }

  return (
    <div className="space-y-2 w-4/5 mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">Clip of the Week</h2>
        {isModerator && (
          <button
            onClick={() => setConfirmOpen(true)}
            className="text-zinc-500 hover:text-red-400 transition-colors"
            aria-label="Remove Clip of the Week"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        )}
      </div>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
        {playing ? (
          <iframe
            src={clipOfWeekEmbedSrc(clip, host)}
            className="w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full cursor-pointer"
            aria-label={`Play ${clip.title}`}
          >
            {poster && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={poster}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/10" />
              </>
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 ring-1 ring-white/30 transition-transform group-hover:scale-110">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" className="ml-1 text-white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <p className="text-white font-medium">{clip.title}</p>
      <p className="text-sm text-zinc-500">
        Posted by{" "}
        {clip.submitted_by_username ? (
          <PlayerName displayName={clip.submitted_by_display_name} username={clip.submitted_by_username} className="text-zinc-400" />
        ) : (
          "a deleted player"
        )}
        {" · "}{clip.likes_count} like{clip.likes_count === 1 ? "" : "s"}
      </p>

      <ClipConfirmModal
        open={confirmOpen}
        title="Remove Clip of the Week?"
        description={error ?? "This clears the featured clip. The clip itself won't be deleted — it'll just stop being pinned at the top."}
        onConfirm={handleConfirm}
        onClose={() => { setConfirmOpen(false); setError(null); }}
        isPending={isPending}
      />
    </div>
  );
}
