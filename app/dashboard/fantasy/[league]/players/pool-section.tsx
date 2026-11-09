"use client";

import { use, useMemo } from "react";
import type { PoolPlayer, PoolView } from "@/app/lib/fantasy-pool-data";
import { PoolTable } from "./pool-table";
import { MoveAction, type RosterMoves } from "./move-action";
import { TradesPanel } from "./trades";

export function PoolSection({ pool, moves }: { pool: Promise<PoolView>; moves: Promise<RosterMoves> | null }) {
  const { players, hiddenForTest } = use(pool);
  const roster = moves ? use(moves) : null;
  const { nameOf, playerOf, rosterOf } = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    const byManager = new Map<string, PoolPlayer[]>();
    for (const p of players) {
      if (!p.manager) continue;
      if (!byManager.has(p.manager.accountId)) byManager.set(p.manager.accountId, []);
      byManager.get(p.manager.accountId)!.push(p);
    }
    return {
      nameOf: (id: string) => byId.get(id)?.name ?? "Unknown player",
      playerOf: (id: string) => byId.get(id),
      rosterOf: (managerId: string) => byManager.get(managerId) ?? [],
    };
  }, [players]);

  if (players.length > 0) {
    return (
      <div className="space-y-4">
        {roster && <TradesPanel moves={roster} playerOf={playerOf} />}
        <PoolTable
          players={players}
          renderAction={
            roster
              ? (p) => <MoveAction player={p} moves={roster} nameOf={nameOf} playerOf={playerOf} rosterOf={rosterOf} />
              : undefined
          }
        />
      </div>
    );
  }
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
