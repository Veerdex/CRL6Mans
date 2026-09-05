"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { submitClip, toggleClipLike, deleteClip, setClipOfWeek, toggleClipConfirmations } from "@/app/dashboard/media/actions";
import { ClipConfirmModal } from "@/app/dashboard/media/clip-confirm-modal";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { isLinkOnlyPlatform, resolveClipEmbedUrl, type ClipPlatform } from "@/app/lib/clip-embed";

const INITIAL_BATCH = 20;
const BATCH_SIZE = 10;

export type Clip = {
  id: string;
  title: string;
  url: string;
  embed_url: string;
  thumbnail_url: string | null;
  platform: ClipPlatform;
  likes_count: number;
  created_at: string;
  submitted_by_username: string | null;
  submitted_by_display_name: string | null;
  submitted_by_discord_id: string | null;
  submitted_by_avatar: string | null;
};

const LINK_ONLY_LABELS: Record<string, string> = {
  tiktok: "Watch on TikTok",
  twitter: "Watch on X",
  instagram: "Watch on Instagram",
};

type SortMode = "chronological" | "likes_desc" | "likes_asc";

function ClipCard({
  clip,
  liked,
  canParticipate,
  isModerator,
}: {
  clip: Clip;
  liked: boolean;
  canParticipate: boolean;
  isModerator: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cowError, setCowError] = useState<string | null>(null);
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

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteClip(clip.id);
      if (result?.error) {
        setDeleteError(result.error);
        return;
      }
      setConfirmOpen(false);
    });
  }

  function handleSetClipOfWeek() {
    setCowError(null);
    startTransition(async () => {
      const result = await setClipOfWeek(clip.id);
      if (result?.error) setCowError(result.error);
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      {isLinkOnlyPlatform(clip.platform) ? (
        <a
          href={clip.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-black text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors"
        >
          {clip.thumbnail_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={clip.thumbnail_url}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
              <span className="absolute bottom-2 left-3 text-white group-hover:text-amber-300 transition-colors">
                {LINK_ONLY_LABELS[clip.platform]} ↗
              </span>
            </>
          ) : (
            <span>{LINK_ONLY_LABELS[clip.platform]} ↗</span>
          )}
        </a>
      ) : (
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-zinc-800 bg-black">
          {/* The feed mounts every clip at once, and a player shell is a few
              hundred KB before it has drawn anything, so loading them eagerly
              spends megabytes on clips most visitors never scroll to. Deferring
              also means a clip nobody reaches never loads a player at all -
              stronger than the autoplay flag, which only stops playback. Clip of
              the Week stays eager: it is above the fold on both Home and here. */}
          <iframe src={resolveClipEmbedUrl(clip, host)} className="w-full h-full" loading="lazy" allowFullScreen />
        </div>
      )}
      <p className="text-white font-medium">{clip.title}</p>
      <p className="text-xs text-zinc-500">
        Posted by{" "}
        {clip.submitted_by_username ? (
          <span className="inline-flex items-center gap-1.5 align-middle max-w-full min-w-0">
            <PlayerAvatar
              discordId={clip.submitted_by_discord_id}
              avatar={clip.submitted_by_avatar}
              username={clip.submitted_by_username}
              className="w-5 h-5"
            />
            <PlayerName displayName={clip.submitted_by_display_name} username={clip.submitted_by_username} discordId={clip.submitted_by_discord_id} className="text-zinc-400" />
          </span>
        ) : (
          // No avatar here on purpose: a default Discord egg beside this would
          // read as a real account rather than an absent one.
          "a deleted player"
        )}
      </p>
      <div className="flex items-center justify-between">
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
        {isModerator && (
          <div className="flex items-center gap-3">
            {!isLinkOnlyPlatform(clip.platform) && (
              <button
                onClick={handleSetClipOfWeek}
                disabled={isPending}
                className="text-xs font-medium text-zinc-500 hover:text-amber-400 transition-colors disabled:opacity-40"
              >
                Set as Clip of the Week
              </button>
            )}
            <button
              onClick={() => setConfirmOpen(true)}
              className="text-zinc-500 hover:text-red-400 transition-colors"
              aria-label="Delete clip"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {likeError && <p className="text-xs text-red-400">{likeError}</p>}
      {cowError && <p className="text-xs text-red-400">{cowError}</p>}

      <ClipConfirmModal
        open={confirmOpen}
        title="Delete this clip?"
        description={deleteError ?? "This permanently removes the clip and its likes. This can't be undone."}
        onConfirm={handleDelete}
        onClose={() => { setConfirmOpen(false); setDeleteError(null); }}
        isPending={isPending}
      />
    </div>
  );
}

export function MediaFeed({
  clips,
  likedClipIds,
  canParticipate,
  isModerator,
  confirmationsEnabled,
}: {
  clips: Clip[];
  likedClipIds: string[];
  canParticipate: boolean;
  isModerator: boolean;
  confirmationsEnabled: boolean;
}) {
  const [sortMode, setSortMode] = useState<SortMode>("chronological");
  const [search, setSearch] = useState("");
  const [onlyLiked, setOnlyLiked] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [durationConfirmed, setDurationConfirmed] = useState(false);
  const [appropriateConfirmed, setAppropriateConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isToggling, startToggleTransition] = useTransition();

  function handleToggleConfirmations() {
    setToggleError(null);
    startToggleTransition(async () => {
      const result = await toggleClipConfirmations();
      if (result?.error) setToggleError(result.error);
    });
  }

  const likedSet = useMemo(() => new Set(likedClipIds), [likedClipIds]);

  const visibleClips = useMemo(() => {
    let filtered = search.trim()
      ? clips.filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()))
      : clips;
    if (onlyLiked) filtered = filtered.filter((c) => likedSet.has(c.id));
    const sorted = [...filtered];
    if (sortMode === "likes_desc") sorted.sort((a, b) => b.likes_count - a.likes_count);
    else if (sortMode === "likes_asc") sorted.sort((a, b) => a.likes_count - b.likes_count);
    else sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return sorted;
  }, [clips, search, sortMode, onlyLiked, likedSet]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset the window back to the initial batch whenever the filter/sort
  // changes, so switching away and back doesn't leave a stale scroll depth
  // mixed with a new result set. Adjusting state during render (React's
  // documented pattern for this) instead of an effect avoids an extra commit.
  const filterKey = `${search}|${sortMode}|${onlyLiked}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(INITIAL_BATCH);
  }

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((count) => Math.min(count + BATCH_SIZE, visibleClips.length));
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleClips.length]);

  const shownClips = visibleClips.slice(0, visibleCount);
  const hasMore = visibleCount < visibleClips.length;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitClip(title, url, durationConfirmed, appropriateConfirmed);
      if (result?.error) {
        setSubmitError(result.error);
        return;
      }
      setTitle("");
      setUrl("");
      setDurationConfirmed(false);
      setAppropriateConfirmed(false);
    });
  }

  return (
    <div className="space-y-6">
      {canParticipate ? (
        <form onSubmit={handleSubmit} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Submit a clip</h2>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clip title"
            maxLength={150}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
          />
          {confirmationsEnabled && (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  type="checkbox"
                  checked={durationConfirmed}
                  onChange={(e) => setDurationConfirmed(e.target.checked)}
                  required
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                I confirm this clip is 60 seconds or shorter
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  type="checkbox"
                  checked={appropriateConfirmed}
                  onChange={(e) => setAppropriateConfirmed(e.target.checked)}
                  required
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                I confirm this clip is appropriate for the league community
              </label>
            </>
          )}
          {isModerator && (
            <div>
              <button
                type="button"
                onClick={handleToggleConfirmations}
                disabled={isToggling}
                className="text-xs font-medium text-zinc-500 hover:text-amber-400 transition-colors disabled:opacity-40"
              >
                {confirmationsEnabled ? "Disable" : "Enable"} confirmation checkboxes
              </button>
              {toggleError && <p className="text-xs text-red-400">{toggleError}</p>}
            </div>
          )}
          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
          <button
            type="submit"
            disabled={isPending || !title.trim() || !url.trim() || (confirmationsEnabled && (!durationConfirmed || !appropriateConfirmed))}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {isPending ? "Submitting…" : "Submit clip"}
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-400">
          <a href="/login" className="text-amber-400 hover:underline">Log in</a> as an approved player to submit clips and like your favorites.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clips…"
          className="w-full sm:max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
            <input
              type="checkbox"
              checked={onlyLiked}
              onChange={(e) => setOnlyLiked(e.target.checked)}
              disabled={!canParticipate}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40"
            />
            Only liked
          </label>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="chronological">Newest first</option>
            <option value="likes_desc">Most liked</option>
            <option value="likes_asc">Least liked</option>
          </select>
        </div>
      </div>

      {visibleClips.length === 0 ? (
        <p className="text-center text-zinc-500 py-8">
          {onlyLiked ? "You haven't liked any clips yet." : "No clips yet — be the first to submit one."}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {shownClips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                liked={likedSet.has(clip.id)}
                canParticipate={canParticipate}
                isModerator={isModerator}
              />
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className="h-1" />}
        </>
      )}
    </div>
  );
}
