"use client";

import { useMemo, useState, useTransition } from "react";
import { approveReplayReview, rejectReplayReview } from "./replay-review-actions";

export type ReplayReviewCardData = {
  matchId: string;
  matchLabel: string;
  homeScore: number;
  awayScore: number;
  games: { gameNumber: number; unmatchedNames: string[]; replayDownloadUrl: string | null }[];
  rosterOptions: { id: string; label: string; teamName: string }[];
};

export function ReplayReviewCard({ review }: { review: ReplayReviewCardData }) {
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The same name can appear in several games of the series; it's one person,
  // so it gets one dropdown and one answer.
  const names = useMemo(
    () => [...new Set(review.games.flatMap((g) => g.unmatchedNames))],
    [review.games],
  );
  const takenIds = new Set(Object.values(mappings).filter(Boolean));
  const allMapped = names.every((n) => !!mappings[n]);

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  };

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{review.matchLabel}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Both teams accepted {review.homeScore}–{review.awayScore}
          </p>
        </div>
        <span className="text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded-full px-2 py-0.5 whitespace-nowrap">
          {names.length} unrecognised
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        {review.games.map((g) => (
          <div key={g.gameNumber} className="text-xs text-zinc-400">
            <span className="text-zinc-500">Game {g.gameNumber}:</span>{" "}
            {g.unmatchedNames.length ? g.unmatchedNames.join(", ") : "all players recognised"}
            {g.replayDownloadUrl && (
              <>
                {" — "}
                <a href={g.replayDownloadUrl} className="text-indigo-400 hover:underline">
                  download replay
                </a>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {names.map((name) => (
          <div key={name} className="flex items-center gap-2">
            <span className="text-sm text-white font-mono truncate flex-1">{name}</span>
            <select
              value={mappings[name] ?? ""}
              onChange={(e) => setMappings((m) => ({ ...m, [name]: e.target.value }))}
              className="bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-white px-2 py-1.5 min-w-56"
            >
              <option value="">Select player…</option>
              {review.rosterOptions
                .filter((o) => o.id === mappings[name] || !takenIds.has(o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} — {o.teamName}
                  </option>
                ))}
            </select>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => run(() => approveReplayReview(review.matchId, mappings))}
          disabled={isPending || !allMapped}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg px-3 py-1.5"
        >
          Fix and finalise
        </button>
        <button
          onClick={() => setRejecting((r) => !r)}
          disabled={isPending}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-sm rounded-lg px-3 py-1.5"
        >
          Reject submission
        </button>
      </div>

      {rejecting && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason — both teams are shown this"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-white px-3 py-1.5"
          />
          <button
            onClick={() => run(() => rejectReplayReview(review.matchId, reason))}
            disabled={isPending || !reason.trim()}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg px-3 py-1.5"
          >
            Confirm reject
          </button>
        </div>
      )}
    </div>
  );
}
