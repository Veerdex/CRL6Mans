"use client";

import { useState, useTransition } from "react";
import { enterDraft, leaveDraft } from "./draft-actions";

interface DraftCardProps {
  inDraft: boolean;
  draftCount: number;
  signupsOpen: boolean;
  draftActive: boolean;
  seasonActive: boolean;
}

export default function DraftCard({ inDraft, draftCount, signupsOpen, draftActive, seasonActive }: DraftCardProps) {
  const [entered, setEntered] = useState(inDraft);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const locked = draftActive || seasonActive;

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = entered ? await leaveDraft() : await enterDraft();
      if (result.error) {
        setError(result.error);
      } else {
        setEntered(!entered);
      }
    });
  }

  const statusLabel = locked && entered
    ? draftActive ? "Draft in progress" : "Season in progress"
    : !signupsOpen
    ? "Draft signups closed"
    : entered
    ? "You're in the draft"
    : "Draft signups open";

  return (
    <div className={`rounded-xl border p-5 flex items-center justify-between gap-4 ${
      entered && signupsOpen
        ? "bg-emerald-950/40 border-emerald-700/50"
        : "bg-zinc-900 border-zinc-700/50"
    }`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${signupsOpen ? "bg-emerald-400" : "bg-zinc-600"}`} />
          <span className="text-sm font-semibold text-white">{statusLabel}</span>
        </div>
        <span className="text-xs text-zinc-400 ml-4">
          {draftCount} player{draftCount !== 1 ? "s" : ""} in the pool
          {draftCount >= 3 && (
            <> · {Math.floor(draftCount / 3)} team{Math.floor(draftCount / 3) !== 1 ? "s" : ""} possible</>
          )}
        </span>
        {error && <span className="text-xs text-red-400 ml-4 mt-1">{error}</span>}
      </div>

      <button
        onClick={handleToggle}
        disabled={isPending || !signupsOpen || (entered && locked)}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
          !signupsOpen || (entered && locked)
            ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            : entered
            ? "bg-red-700 hover:bg-red-600 text-white"
            : "bg-emerald-600 hover:bg-emerald-500 text-white"
        }`}
      >
        {isPending ? "..." : entered ? "Leave Draft" : "Enter Draft"}
      </button>
    </div>
  );
}
