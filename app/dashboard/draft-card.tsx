"use client";

import { useState, useTransition } from "react";
import { enterDraft, leaveDraft } from "./draft-actions";

interface DraftCardProps {
  inDraft: boolean;
  draftCount: number;
  signupsOpen: boolean;
  draftActive: boolean;
  seasonActive: boolean;
  queuePosition: number | null;
  cutoffSize: number;
  subWilling: boolean;
}

export default function DraftCard({
  inDraft, draftCount, signupsOpen, draftActive, seasonActive,
  queuePosition, cutoffSize, subWilling,
}: DraftCardProps) {
  const [entered, setEntered] = useState(inDraft);
  const [localPosition, setLocalPosition] = useState(queuePosition);
  const [localCount, setLocalCount] = useState(draftCount);
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
        if (entered) {
          setLocalPosition(null);
          setLocalCount(c => Math.max(0, c - 1));
        } else {
          setLocalCount(c => c + 1);
        }
        setEntered(!entered);
      }
    });
  }

  const inCutoff = localPosition !== null && cutoffSize > 0 && localPosition <= cutoffSize;

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
        ? inCutoff ? "bg-emerald-950/40 border-emerald-700/50" : "bg-amber-950/30 border-amber-700/40"
        : "bg-zinc-900 border-zinc-700/50"
    }`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            !entered || !signupsOpen ? "bg-zinc-600" : inCutoff ? "bg-emerald-400" : "bg-amber-400"
          }`} />
          <span className="text-sm font-semibold text-white">{statusLabel}</span>
        </div>
        <span className="text-xs text-zinc-400 ml-4">
          {localCount} player{localCount !== 1 ? "s" : ""} in the pool
          {localCount >= 3 && (
            <> · {Math.floor(localCount / 3)} team{Math.floor(localCount / 3) !== 1 ? "s" : ""} possible</>
          )}
        </span>
        {entered && localPosition !== null && signupsOpen && (
          <span className={`text-xs ml-4 mt-0.5 ${inCutoff ? "text-emerald-400" : "text-amber-400"}`}>
            {inCutoff
              ? `Queue position #${localPosition} — you're in the draft cutoff (top ${cutoffSize})`
              : `Queue position #${localPosition} — outside cutoff (${cutoffSize} spots)${subWilling ? " · marked as sub" : ""}`
            }
          </span>
        )}
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
