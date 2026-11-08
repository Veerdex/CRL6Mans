"use client";

import { use } from "react";
import type { PoolView } from "@/app/lib/fantasy-pool-data";
import { PoolTable } from "./pool-table";

export function PoolSection({ pool }: { pool: Promise<PoolView> }) {
  const { players, hiddenForTest } = use(pool);
  if (players.length > 0) return <PoolTable players={players} />;
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 text-sm text-zinc-300 text-center">
      {hiddenForTest
        ? "The player pool opens when the next season starts."
        : "No players yet. The pool fills as players are drafted onto teams."}
    </div>
  );
}

export function PoolSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading players" className="space-y-3 animate-pulse">
      <div className="h-10 rounded-lg bg-zinc-800" />
      <div className="rounded-xl border border-zinc-700 bg-zinc-800 overflow-hidden">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-12 border-t border-zinc-700 first:border-t-0 even:bg-zinc-700/30" />
        ))}
      </div>
    </div>
  );
}
