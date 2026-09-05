"use client";

import { useState } from "react";
import { StatsTable, type PlayerStatRow } from "./stats-table";

export type StatsScope = "current" | "allTime";

export function StatsView({
  currentRows,
  allTimeRows,
  showToggle,
}: {
  currentRows: PlayerStatRow[];
  allTimeRows: PlayerStatRow[];
  showToggle: boolean;
}) {
  const [scope, setScope] = useState<StatsScope>(showToggle ? "current" : "allTime");
  const rows = scope === "current" ? currentRows : allTimeRows;

  return (
    <>
      {showToggle && (
        <div className="inline-flex mb-4 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {([
            ["current", "Current Event"],
            ["allTime", "All Time"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                scope === key ? "bg-indigo-600 text-on-accent" : "text-zinc-400 hover:text-zinc-200"
              }`}
              aria-pressed={scope === key}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <p className="text-zinc-500 text-sm mb-4">
        {scope === "current"
          ? "Per-player performance from this event's uploaded game replays. Click any column header to sort."
          : "Per-player performance across every event, including the one in progress. Click any column header to sort."}
      </p>
      <StatsTable rows={rows} />
    </>
  );
}
