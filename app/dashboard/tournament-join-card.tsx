"use client";

import { useState, useTransition } from "react";
import { joinTournament, leaveTournament } from "./tournament-join-actions";
import { LocalTime } from "./local-time";
import { TrackerConfirmModal } from "./tracker-confirm-modal";

export function TournamentJoinCard({
  id,
  name,
  poolCount,
  joined: initialJoined,
  teamAssignment,
  timeline = [],
  minMmr2v2,
  minMmr3v3,
}: {
  id: string;
  name: string;
  poolCount: number;
  joined: boolean;
  teamAssignment: "snake_draft" | "auto_balance" | null;
  timeline?: { label: string; iso: string }[];
  minMmr2v2?: number | null;
  minMmr3v3?: number | null;
}) {
  const [joined, setJoined] = useState(initialJoined);
  const [count, setCount] = useState(poolCount);
  const [error, setError] = useState<string | null>(null);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [trackerStale, setTrackerStale] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    setError(null);
    setInviteRequired(false);
    setTrackerStale(false);
    startTransition(async () => {
      const res = joined ? await leaveTournament(id) : await joinTournament(id);
      if ("inviteRequired" in res && res.inviteRequired) { setInviteRequired(true); return; }
      if ("trackerStale" in res && res.trackerStale) { setTrackerStale(true); return; }
      if (res.error) { setError(res.error); return; }
      setJoined(!joined);
      setCount((c) => Math.max(0, c + (joined ? -1 : 1)));
    });
  };

  const confirmSameAndJoin = () => {
    setError(null);
    setTrackerStale(false);
    startTransition(async () => {
      const res = await joinTournament(id, true);
      if (res.error) { setError(res.error); return; }
      setJoined(true);
      setCount((c) => c + 1);
    });
  };

  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-3 ${
      joined ? "bg-emerald-950/30 border-emerald-700/40" : "bg-zinc-900 border-zinc-700/50"
    }`}>
      <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-semibold text-white truncate">{name}</span>
        <span className="text-xs text-zinc-400">
          {count} in the pool · {teamAssignment === "auto_balance" ? "auto-balanced" : "snake draft"}
        </span>
        {(minMmr2v2 || minMmr3v3) && (
          <span className="text-xs text-zinc-500">
            Req:{" "}
            {[minMmr2v2 ? `${minMmr2v2} 2v2` : null, minMmr3v3 ? `${minMmr3v3} 3v3` : null]
              .filter(Boolean).join(" or ")} peak MMR
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      <button
        onClick={toggle}
        disabled={isPending}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0 ${
          joined ? "bg-red-700 hover:bg-red-600 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"
        }`}
      >
        {isPending ? "..." : joined ? "Leave" : "Join"}
      </button>
      </div>
      {timeline.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 border-t border-zinc-700/40">
          {timeline.map(({ label, iso }) => (
            <span key={label} className="text-xs text-zinc-500">
              {label}: <LocalTime iso={iso} className="text-zinc-400" />
            </span>
          ))}
        </div>
      )}
      {inviteRequired && (
        <div className="p-3 bg-indigo-950/60 border border-indigo-700/50 rounded-lg text-xs text-indigo-200 flex flex-col gap-1.5">
          <span className="font-semibold">You must be in the Discord server to join this tournament.</span>
          <a
            href={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline font-medium"
          >
            Join the server →
          </a>
        </div>
      )}
      <TrackerConfirmModal
        open={trackerStale}
        onConfirm={confirmSameAndJoin}
        onClose={() => setTrackerStale(false)}
        isPending={isPending}
      />
    </div>
  );
}
