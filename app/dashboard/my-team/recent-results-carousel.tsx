"use client";

import { useState } from "react";

export type ResultEntry = {
  id: string;
  won: boolean;
  opponentName: string;
  myScore: number;
  theirScore: number;
  stageLabel: string;
};

export function RecentResultsCarousel({ results }: { results: ResultEntry[] }) {
  const [idx, setIdx] = useState(0);

  if (results.length === 0) {
    return <p className="px-5 py-4 text-sm text-zinc-500">No results yet.</p>;
  }

  const r = results[idx];

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      {/* Left arrow */}
      <button
        onClick={() => setIdx((i) => i - 1)}
        disabled={idx === 0}
        className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors shrink-0"
        aria-label="Previous result"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Result content */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className={`text-xs font-bold w-7 h-7 rounded flex items-center justify-center shrink-0 ${
          r.won ? "bg-emerald-700/50 text-emerald-300" : "bg-red-800/50 text-red-300"
        }`}>
          {r.won ? "W" : "L"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate">vs {r.opponentName}</p>
          <p className="text-[10px] text-zinc-500 truncate">{r.stageLabel}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-mono font-semibold tabular-nums ${r.won ? "text-emerald-400" : "text-red-400"}`}>
            {r.myScore}–{r.theirScore}
          </p>
          <p className="text-[10px] text-zinc-600 tabular-nums">{idx + 1} / {results.length}</p>
        </div>
      </div>

      {/* Right arrow */}
      <button
        onClick={() => setIdx((i) => i + 1)}
        disabled={idx === results.length - 1}
        className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors shrink-0"
        aria-label="Next result"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
