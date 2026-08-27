"use client";

import { useState, useTransition } from "react";
import { clearClipOfWeek } from "@/app/media/actions";
import { ClipConfirmModal } from "@/app/media/clip-confirm-modal";
import type { Clip } from "@/app/media/media-feed";

function clipOfWeekEmbedSrc(clip: Clip): string {
  if (clip.platform === "youtube") return `${clip.embed_url}?autoplay=1&mute=1`;
  if (clip.platform === "streamable") return `${clip.embed_url}?autoplay=1&muted=1`;
  if (clip.platform === "medal") return `${clip.embed_url}?autoplay=true`;
  return clip.embed_url;
}

export function ClipOfWeek({ clip, isModerator }: { clip: Clip | null; isModerator: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!clip) return null;

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
    <div className="space-y-2">
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
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <iframe
          src={clipOfWeekEmbedSrc(clip)}
          className="w-full h-full"
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
      </div>
      <p className="text-white font-medium">{clip.title}</p>
      <p className="text-sm text-zinc-500">{clip.likes_count} like{clip.likes_count === 1 ? "" : "s"}</p>

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
