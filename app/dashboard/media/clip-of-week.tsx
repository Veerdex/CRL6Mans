"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { clearClipOfWeek, toggleClipLike } from "@/app/dashboard/media/actions";
import { ClipConfirmModal } from "@/app/dashboard/media/clip-confirm-modal";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { resolveClipEmbedUrl } from "@/app/lib/clip-embed";
import type { Clip } from "@/app/dashboard/media/media-feed";

type CardProps = { isModerator: boolean; liked: boolean; canParticipate: boolean };

// The body lives in a separate component so the "no clip crowned yet" guard can
// return before any hook runs — the like state needs a non-null clip to read its
// count from, and hooks can't sit behind an early return.
export function ClipOfWeek({ clip, ...rest }: { clip: Clip | null } & CardProps) {
  if (!clip) return null;
  return <ClipOfWeekCard clip={clip} {...rest} />;
}

function ClipOfWeekCard({ clip, isModerator, liked, canParticipate }: { clip: Clip } & CardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Twitch embeds need the page's real hostname, but reading it during the
  // initial render would differ between server and client and cause a
  // hydration mismatch — so it starts null (matching the server) and is
  // filled in after mount.
  const [host, setHost] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of window.location, not an ongoing sync
  useEffect(() => setHost(window.location.hostname), []);

  // Reflects the toggle instantly instead of waiting on the server action +
  // revalidatePath round trip. Automatically reverts to the real liked/
  // likes_count props once that round trip settles (success or error).
  const [optimisticLike, setOptimisticLike] = useOptimistic(
    { liked, likes_count: clip.likes_count },
    (_state, nextLiked: boolean) => ({
      liked: nextLiked,
      likes_count: clip.likes_count + (nextLiked ? 1 : -1),
    })
  );

  function handleLike() {
    setLikeError(null);
    const nextLiked = !liked;
    startTransition(async () => {
      setOptimisticLike(nextLiked);
      const result = await toggleClipLike(clip.id);
      if (result?.error) setLikeError(result.error);
    });
  }

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
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <iframe src={resolveClipEmbedUrl(clip, host)} className="w-full h-full" allowFullScreen />
      </div>
      <p className="text-white font-medium">{clip.title}</p>
      <p className="text-sm text-zinc-500">
        Posted by{" "}
        {clip.submitted_by_username ? (
          <span className="inline-flex items-center gap-1.5 align-middle max-w-full min-w-0">
            <PlayerAvatar
              discordId={clip.submitted_by_discord_id}
              avatar={clip.submitted_by_avatar}
              username={clip.submitted_by_username}
              className="w-6 h-6"
            />
            <PlayerName displayName={clip.submitted_by_display_name} username={clip.submitted_by_username} className="text-zinc-400" />
          </span>
        ) : (
          "a deleted player"
        )}
      </p>
      <button
        onClick={handleLike}
        disabled={!canParticipate || isPending}
        className={`inline-flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
          optimisticLike.liked ? "text-amber-400" : "text-zinc-400 hover:text-amber-400"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={optimisticLike.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
        {optimisticLike.likes_count}
      </button>
      {likeError && <p className="text-xs text-red-400">{likeError}</p>}

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
