"use client";

import { useState, useTransition } from "react";
import { enterDraft, leaveDraft } from "./draft-actions";
import { TrackerConfirmModal } from "./tracker-confirm-modal";

interface DraftCardProps {
  inDraft: boolean;
  draftCount: number;
  signupsOpen: boolean;
  draftActive: boolean;
  seasonActive: boolean;
}

export default function DraftCard({
  inDraft, draftCount, signupsOpen, draftActive, seasonActive,
}: DraftCardProps) {
  const [entered, setEntered] = useState(inDraft);
  const [localCount, setLocalCount] = useState(draftCount);
  const [error, setError] = useState<string | null>(null);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [trackerStale, setTrackerStale] = useState(false);
  const [isPending, startTransition] = useTransition();

  const locked = draftActive || seasonActive;

  function handleToggle() {
    setError(null);
    setInviteRequired(false);
    setTrackerStale(false);
    startTransition(async () => {
      const result = entered ? await leaveDraft() : await enterDraft();
      if ("inviteRequired" in result && result.inviteRequired) {
        setInviteRequired(true);
      } else if ("trackerStale" in result && result.trackerStale) {
        setTrackerStale(true);
      } else if (result.error) {
        setError(result.error);
      } else {
        setLocalCount(c => entered ? Math.max(0, c - 1) : c + 1);
        setEntered(!entered);
      }
    });
  }

  function confirmSameAndEnter() {
    setError(null);
    setTrackerStale(false);
    startTransition(async () => {
      const result = await enterDraft(true);
      if (result.error) {
        setError(result.error);
      } else {
        setLocalCount(c => c + 1);
        setEntered(true);
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
          <div className={`w-2 h-2 rounded-full ${
            entered && signupsOpen ? "bg-emerald-400" : "bg-zinc-600"
          }`} />
          <span className="text-sm font-semibold text-white">{statusLabel}</span>
        </div>
        <span className="text-xs text-zinc-400 ml-4">
          {localCount} player{localCount !== 1 ? "s" : ""} in the pool
          {localCount >= 3 && (
            <> · {Math.floor(localCount / 3)} team{Math.floor(localCount / 3) !== 1 ? "s" : ""} possible</>
          )}
        </span>
        {error && <span className="text-xs text-red-400 ml-4 mt-1">{error}</span>}
        {inviteRequired && (
          <div className="ml-4 mt-2 p-3 bg-indigo-950/60 border border-indigo-700/50 rounded-lg text-xs text-indigo-200 flex flex-col gap-1.5">
            <span className="font-semibold">You must be in the Discord server to enter the draft.</span>
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
          onConfirm={confirmSameAndEnter}
          onClose={() => setTrackerStale(false)}
          isPending={isPending}
        />
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
