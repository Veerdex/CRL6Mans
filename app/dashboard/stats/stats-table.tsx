"use client";

import { useState } from "react";
import { PlayerName } from "@/app/dashboard/player-name";

export type PlayerStatRow = {
  playerId: string;
  username: string;
  displayName: string | null;
  teamName: string | null;
  games: number;
  totalGoals: number;
  totalAssists: number;
  totalSaves: number;
  totalShots: number;
  totalScore: number;
  totalDemos: number;
  totalDemoed: number;
};

type SortKey = "mvp" | "goals" | "assists" | "saves" | "score" | "shots" | "shootingPct" | "demos" | "demoed"
             | "totalGoals" | "totalAssists" | "totalSaves" | "totalScore" | "totalShots" | "totalDemos" | "totalDemoed";
type SortDir = "desc" | "asc";

function mvpScore(row: PlayerStatRow): number {
  const { games, totalGoals, totalAssists, totalSaves, totalShots, totalScore } = row;
  if (games === 0) return 0;
  return (
    (totalGoals + totalAssists + totalSaves + totalShots / 10) / (games * 4) +
    totalScore / games / 1000
  );
}

function shootingPct(row: PlayerStatRow): number {
  if (row.totalShots === 0) return 0;
  return (row.totalGoals / row.totalShots) * 100;
}

function sortValue(row: PlayerStatRow, key: SortKey): number {
  const g = row.games;
  switch (key) {
    case "mvp":          return mvpScore(row);
    case "goals":        return g > 0 ? row.totalGoals / g : 0;
    case "assists":      return g > 0 ? row.totalAssists / g : 0;
    case "saves":        return g > 0 ? row.totalSaves / g : 0;
    case "score":        return g > 0 ? row.totalScore / g : 0;
    case "shots":        return g > 0 ? row.totalShots / g : 0;
    case "shootingPct":  return shootingPct(row);
    case "demos":        return g > 0 ? row.totalDemos / g : 0;
    case "demoed":       return g > 0 ? row.totalDemoed / g : 0;
    case "totalGoals":   return row.totalGoals;
    case "totalAssists": return row.totalAssists;
    case "totalSaves":   return row.totalSaves;
    case "totalScore":   return row.totalScore;
    case "totalShots":   return row.totalShots;
    case "totalDemos":   return row.totalDemos;
    case "totalDemoed":  return row.totalDemoed;
  }
}

const COLS: { key: SortKey; label: string; title: string; decimals: number; suffix?: string; group?: string }[] = [
  { key: "mvp",          label: "MVP",   title: "MVP score — composite performance metric",    decimals: 3,                group: "avg" },
  { key: "goals",        label: "G/G",   title: "Goals per game",                             decimals: 2,                group: "avg" },
  { key: "assists",      label: "A/G",   title: "Assists per game",                           decimals: 2,                group: "avg" },
  { key: "saves",        label: "Sv/G",  title: "Saves per game",                             decimals: 2,                group: "avg" },
  { key: "score",        label: "Sc/G",  title: "Score per game",                             decimals: 0,                group: "avg" },
  { key: "shots",        label: "Sh/G",  title: "Shots per game",                             decimals: 2,                group: "avg" },
  { key: "shootingPct",  label: "Sh%",   title: "Shooting percentage (goals / shots)",        decimals: 1, suffix: "%",   group: "avg" },
  { key: "demos",        label: "D/G",   title: "Demos per game",                             decimals: 2,                group: "avg" },
  { key: "demoed",       label: "Dd/G",  title: "Times demoed per game",                       decimals: 2,                group: "avg" },
  { key: "totalGoals",   label: "Gls",   title: "Total goals",                                decimals: 0,                group: "tot" },
  { key: "totalAssists", label: "Ast",   title: "Total assists",                              decimals: 0,                group: "tot" },
  { key: "totalSaves",   label: "Sv",    title: "Total saves",                                decimals: 0,                group: "tot" },
  { key: "totalScore",   label: "Score", title: "Total score",                                decimals: 0,                group: "tot" },
  { key: "totalShots",   label: "Sh",    title: "Total shots",                                decimals: 0,                group: "tot" },
  { key: "totalDemos",   label: "Dm",    title: "Total demos",                                decimals: 0,                group: "tot" },
  { key: "totalDemoed",  label: "Dmd",   title: "Total times demoed",                          decimals: 0,                group: "tot" },
];

export function StatsTable({ rows }: { rows: PlayerStatRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("mvp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
    return sortDir === "desc" ? -diff : diff;
  });

  if (sorted.length === 0) {
    return (
      <div className="stats-bg rounded-xl border border-zinc-800 px-6 py-12 text-center text-zinc-500 text-sm">
        No stats recorded yet — upload replays in the Score Confirmation panel to track per-player performance.
      </div>
    );
  }

  return (
    <div className="stats-bg overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-8">#</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Player</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Team</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 whitespace-nowrap">GP</th>
            {COLS.map((col, i) => {
              const prevGroup = i > 0 ? COLS[i - 1].group : col.group;
              const groupBorder = col.group !== prevGroup ? "border-l border-zinc-700" : "";
              return (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  title={col.title}
                  className={[
                    "px-4 py-3 text-right text-xs font-semibold cursor-pointer select-none whitespace-nowrap transition-colors",
                    groupBorder,
                    sortKey === col.key ? "text-amber-400" : "text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-0.5 text-[10px]">{sortDir === "desc" ? " ▼" : " ▲"}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.playerId} className="border-b border-zinc-800/40 hover:bg-zinc-800/25 transition-colors">
              <td className="px-4 py-3 text-zinc-600 text-xs tabular-nums">{i + 1}</td>
              <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                <PlayerName displayName={row.displayName} username={row.username} />
              </td>
              <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">{row.teamName ?? "—"}</td>
              <td className="px-4 py-3 text-right text-zinc-400 tabular-nums">{row.games}</td>
              {COLS.map((col, i) => {
                const v = sortValue(row, col.key);
                const display = v.toFixed(col.decimals) + (col.suffix ?? "");
                const prevGroup = i > 0 ? COLS[i - 1].group : col.group;
                const groupBorder = col.group !== prevGroup ? "border-l border-zinc-800" : "";
                return (
                  <td
                    key={col.key}
                    className={[
                      "px-4 py-3 text-right tabular-nums",
                      groupBorder,
                      sortKey === col.key ? "text-amber-300 font-medium" : "text-zinc-300",
                    ].join(" ")}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
