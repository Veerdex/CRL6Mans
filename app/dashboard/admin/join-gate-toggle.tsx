"use client";

import { useState, useTransition } from "react";
import { setJoinGateEnabled } from "./identity-discrepancy-actions";

export function JoinGateToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
      <div>
        <p className="text-sm font-medium text-white">Verified Account Join Gate</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {enabled
            ? "ON — joining a draft, tournament, or team requires an active verified platform account"
            : "OFF — anyone approved can join regardless of platform account verification"}
        </p>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <button
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          setError(null);
          startTransition(async () => {
            const res = await setJoinGateEnabled(next);
            if (res.error) {
              setEnabled(!next);
              setError(res.error);
            }
          });
        }}
        disabled={isPending}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${enabled ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}
