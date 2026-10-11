"use client";

import { useState, useTransition } from "react";
import { completeSeason } from "./league-actions";

/**
 * Ends a manual season: archives it to Past Events, then resets the league.
 *
 * This is the only route from an active manual season to an archived one, which
 * is why it keeps a two-step confirmation — it deletes every match, unassigns
 * every player and strips the team roles. The report is no longer downloaded
 * here; the archived season's own Export button hands over both files once the
 * season has been completed.
 */
export function CompleteSeasonButton() {
  const [step, setStep] = useState<"idle" | "warn" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleConfirm() {
    setStep("working");
    setError(null);
    startTransition(async () => {
      const res = await completeSeason();
      if (res.error) { setError(res.error); setStep("warn"); return; }
      setStep("done");
    });
  }

  if (step === "done") {
    return (
      <span className="text-xs text-emerald-400 font-medium">
        Season archived · export it from Past Events
      </span>
    );
  }

  if (step === "warn" || step === "working") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-zinc-300 leading-relaxed">
          This archives the final standings to Past Events, then resets the season — deleting
          matches, unassigning players, and stripping team roles. This cannot be undone. Download
          the report afterwards with Export on the archived season.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleConfirm}
            disabled={step === "working"}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            {step === "working" ? "Archiving…" : "Complete Season"}
          </button>
          {step !== "working" && (
            <button
              onClick={() => { setStep("idle"); setError(null); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setStep("warn")}
      className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 border border-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
    >
      Complete Season
    </button>
  );
}
