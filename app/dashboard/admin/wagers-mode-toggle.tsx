"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBettingMode, type BettingMode } from "@/app/dashboard/wagers/actions";

export function WagersModeToggle({ currentMode }: { currentMode: BettingMode }) {
  const router = useRouter();
  const [localMode, setLocalMode] = useState<BettingMode>(currentMode);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    const next: BettingMode = localMode === "pool" ? "fixed" : "pool";
    startTransition(async () => {
      const res = await setBettingMode(next);
      if (res.error) {
        setError(res.error);
        return;
      }
      setLocalMode(next);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-white">Betting Mode</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          League-wide default for newly-opened matches — {localMode === "pool" ? "Pool Mode" : "Fixed Odds"}.
          Matches with bets already placed keep whichever mode they opened in.
        </p>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <button
        onClick={handleClick}
        disabled={isPending}
        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 shrink-0 ${
          localMode === "pool"
            ? "bg-amber-600/20 border border-amber-500 text-amber-300 hover:bg-amber-600/30"
            : "bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700"
        }`}
      >
        {isPending ? "…" : localMode === "pool" ? "Pool Mode" : "Fixed Odds"}
      </button>
    </div>
  );
}
