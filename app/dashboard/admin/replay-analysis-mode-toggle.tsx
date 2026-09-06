"use client";

import { useState, useTransition } from "react";
import { setReplayAnalysisMode } from "./replay-review-actions";
import type { ReplayAnalysisMode } from "@/app/lib/replay-analysis-mode";

const COPY: Record<ReplayAnalysisMode, string> = {
  loose: "Loose — a replay with unrecognised players warns the teams and submits anyway. Those players get no stats.",
  strict: "Strict — a series whose replays contain unrecognised players goes to an admin once both teams accept the score.",
};

export function ReplayAnalysisModeToggle({ initialMode }: { initialMode: ReplayAnalysisMode }) {
  const [mode, setMode] = useState<ReplayAnalysisMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const strict = mode === "strict";

  return (
    <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
      <div className="pr-4">
        <p className="text-sm font-medium text-white">Replay Analysis</p>
        <p className="text-xs text-zinc-500 mt-0.5">{COPY[mode]}</p>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <button
        onClick={() => {
          const next: ReplayAnalysisMode = strict ? "loose" : "strict";
          const prev = mode;
          setMode(next);
          setError(null);
          startTransition(async () => {
            const res = await setReplayAnalysisMode(next);
            if (res.error) {
              setMode(prev);
              setError(res.error);
            }
          });
        }}
        disabled={isPending}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          strict ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"
        }`}
        role="switch"
        aria-checked={strict}
        aria-label="Strict replay analysis"
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${strict ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}
