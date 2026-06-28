"use client";

import { useState } from "react";

export type LeaderboardEntry = { username: string; display_name: string | null; crl_coins: number };

export function LeaderboardView({
  entries,
  currentUsername,
  search,
  onSearchChange,
}: {
  entries: LeaderboardEntry[];
  currentUsername: string;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? entries.filter(
        (e) =>
          e.username.toLowerCase().includes(q) ||
          (e.display_name ?? "").toLowerCase().includes(q),
      )
    : entries;

  return (
    <div className="w-full px-6 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
        <h2 className="text-base font-bold text-white">Westside Wages Leaderboard</h2>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Rows */}
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No players found</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((entry, i) => {
            const globalRank = entries.indexOf(entry) + 1;
            const isMe = entry.username === currentUsername;
            const name = entry.display_name ?? entry.username;
            const rankColor =
              globalRank === 1
                ? "text-amber-400"
                : globalRank === 2
                  ? "text-zinc-300"
                  : globalRank === 3
                    ? "text-amber-700"
                    : "text-zinc-600";

            return (
              <div
                key={`${entry.username}-${i}`}
                className={[
                  "flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors",
                  isMe
                    ? "bg-amber-900/20 border-amber-700/50"
                    : "bg-zinc-800/40 border-zinc-800 hover:border-zinc-700",
                ].join(" ")}
              >
                <span className={`text-sm font-bold tabular-nums w-7 shrink-0 ${rankColor}`}>
                  {globalRank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate ${isMe ? "text-amber-300" : "text-white"}`}>
                    {name}
                    {isMe && <span className="ml-2 text-[10px] font-bold text-amber-500 uppercase tracking-widest">You</span>}
                  </p>
                  {entry.display_name && (
                    <p className="text-[11px] text-zinc-500 truncate">@{entry.username}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-sm">🪙</span>
                  <span className={`text-sm font-bold tabular-nums ${isMe ? "text-amber-400" : "text-zinc-200"}`}>
                    {entry.crl_coins.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Standalone view shown when no season/tournament is active: the persistent Westside
// Wages standings (and the viewer's balance), with no betting market.
export function WagesLeaderboardOnly({
  entries,
  currentUsername,
  balance,
}: {
  entries: LeaderboardEntry[];
  currentUsername: string;
  balance: number;
}) {
  const [search, setSearch] = useState("");
  return (
    <div className="w-full">
      <div className="max-w-2xl mx-auto px-6 pt-6">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div>
            <p className="text-xs text-zinc-500">No active event — betting opens when the next season or tournament starts.</p>
            <p className="text-[11px] text-zinc-600 mt-0.5">Your Westside Wages carry over between events.</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-base">🪙</span>
            <span className="text-base font-bold tabular-nums text-amber-400">{balance.toLocaleString()}</span>
          </div>
        </div>
      </div>
      <LeaderboardView
        entries={entries}
        currentUsername={currentUsername}
        search={search}
        onSearchChange={setSearch}
      />
    </div>
  );
}
