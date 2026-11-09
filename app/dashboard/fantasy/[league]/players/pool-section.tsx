"use client";

import { use, useCallback, useMemo, useState } from "react";
import type { PoolPlayer, PoolView } from "@/app/lib/fantasy-pool-data";
import { PoolTable } from "./pool-table";
import { MoveAction, type RosterMoves } from "./move-action";
import { TradesPanel } from "./trades";
import { FROZEN_NOTE } from "@/app/lib/fantasy-schedule";

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

  const [view, setView] = useState<"free" | "trade">("free");
  const managerId = roster?.managerId;
  const othersRostered = useCallback((p: PoolPlayer) => !!p.manager && p.manager.accountId !== managerId, [managerId]);

  if (players.length > 0) {
    if (!roster) return <PoolTable players={players} />;
    const action = (p: PoolPlayer) => (
      <MoveAction player={p} moves={roster} nameOf={nameOf} playerOf={playerOf} rosterOf={rosterOf} />
    );
    const offers = roster.trades.filter((t) => t.status === "pending" && t.receiverId === roster.managerId).length;
    return (
      <div className="space-y-4">
        {roster.eliminated.includes(roster.managerId) && (
          <p className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-300 text-center">
            {FROZEN_NOTE}
          </p>
        )}
        <div role="tablist" aria-label="Players view" className="mx-auto flex w-fit rounded-lg border border-zinc-700 bg-zinc-900 p-1">
          <ViewTab active={view === "free"} onClick={() => setView("free")}>
            Free agents &amp; waivers
          </ViewTab>
          <ViewTab active={view === "trade"} onClick={() => setView("trade")}>
            Trades
            {offers > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-on-accent">{offers}</span>
            )}
          </ViewTab>
        </div>
        {view === "free" ? (
          <PoolTable key="free" players={players} include={unrostered} allLabel="All" renderAction={action} />
        ) : (
          <>
            <TradesPanel moves={roster} playerOf={playerOf} />
            <PoolTable key="trade" players={players} include={othersRostered} statusChips={false} renderAction={action} />
          </>
        )}
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

const unrostered = (p: PoolPlayer) => !p.manager;

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-indigo-500 text-on-accent" : "text-zinc-300 hover:text-white"
      }`}
    >
      {children}
    </button>
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
