"use client";

import { useState, useTransition } from "react";
import { rankFantasyClaims } from "../../actions";

const ARROW = "rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent";

/** Moves one claim up or down the manager's preference. `ids` is the current order. */
export function ClaimRankButtons({ leagueId, ids, index }: { leagueId: string; ids: string[]; index: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = (to: number) =>
    start(async () => {
      const next = [...ids];
      [next[index], next[to]] = [next[to], next[index]];
      const res = await rankFantasyClaims(leagueId, next);
      setError(res.error ?? null);
    });
  return (
    <span className="inline-flex items-center">
      {error && <span className="mr-2 text-xs text-red-400">{error}</span>}
      <button type="button" aria-label="Want this one more" disabled={pending || index === 0} onClick={() => move(index - 1)} className={ARROW}>
        ▲
      </button>
      <button
        type="button"
        aria-label="Want this one less"
        disabled={pending || index === ids.length - 1}
        onClick={() => move(index + 1)}
        className={ARROW}
      >
        ▼
      </button>
    </span>
  );
}
