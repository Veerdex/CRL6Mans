"use client";

import { useState, useTransition } from "react";
import { simulateMatch, simulateRound } from "./simulate-actions";
import { advanceGroupsToSE, advanceGroupsToSwiss, advanceSEQualifierToSwiss, advanceDEQualifierToSwiss, advanceSwissRound, advanceSwissToSE } from "./actions";

interface SimulateControlsProps {
  showAdvanceToSE?: boolean;
  showAdvanceToSwiss?: boolean;
  showAdvanceSEToSwiss?: boolean;
  showAdvanceDEToSwiss?: boolean;
  showNextSwissRound?: boolean;
  showSwissToSE?: boolean;
}

export function SimulateControls({
  showAdvanceToSE = false,
  showAdvanceToSwiss = false,
  showAdvanceSEToSwiss = false,
  showAdvanceDEToSwiss = false,
  showNextSwissRound = false,
  showSwissToSE = false,
}: SimulateControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function run(action: () => Promise<{ error?: string; ok?: boolean }>, successMsg?: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else if (successMsg) setSuccess(successMsg);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-zinc-500 font-medium">Testing:</span>
      <button
        onClick={() => run(simulateMatch)}
        disabled={isPending}
        className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
      >
        Simulate Match
      </button>
      <button
        onClick={() => run(simulateRound)}
        disabled={isPending}
        className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
      >
        Simulate Round
      </button>
      {showAdvanceToSE && (
        <button
          onClick={() => run(advanceGroupsToSE, "SE bracket generated!")}
          disabled={isPending}
          className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Advance to SE →
        </button>
      )}
      {showAdvanceToSwiss && (
        <button
          onClick={() => run(advanceGroupsToSwiss, "Swiss stage generated!")}
          disabled={isPending}
          className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Advance to Swiss →
        </button>
      )}
      {showAdvanceSEToSwiss && (
        <button
          onClick={() => run(advanceSEQualifierToSwiss, "Swiss stage generated!")}
          disabled={isPending}
          className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Advance to Swiss →
        </button>
      )}
      {showAdvanceDEToSwiss && (
        <button
          onClick={() => run(advanceDEQualifierToSwiss, "Swiss stage generated!")}
          disabled={isPending}
          className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Advance to Swiss →
        </button>
      )}
      {showNextSwissRound && (
        <button
          onClick={() => run(advanceSwissRound, "Next Swiss round generated!")}
          disabled={isPending}
          className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Next Swiss Round →
        </button>
      )}
      {showSwissToSE && (
        <button
          onClick={() => run(advanceSwissToSE, "SE bracket generated!")}
          disabled={isPending}
          className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Advance to SE →
        </button>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {success && <span className="text-xs text-emerald-400">{success}</span>}
    </div>
  );
}
