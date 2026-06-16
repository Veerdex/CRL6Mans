"use client";

import { useState } from "react";

export type StandingsRow = {
  id: string;
  name: string;
  logo_url: string | null;
  wins: number;
  losses: number;
  gp: number;
};

export function StandingsClient({ rows, highlightTeamId }: { rows: StandingsRow[]; highlightTeamId?: string | null }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    : rows;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header row: title + search + collapse */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 group shrink-0"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className={`text-zinc-500 group-hover:text-zinc-300 transition-all duration-150 shrink-0 ${open ? "rotate-0" : "-rotate-90"}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors">
            Standings (Overall)
          </span>
        </button>

        {open && (
          <div className="relative flex-1 max-w-xs ml-auto">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search teams…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
      </div>

      {open && (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 w-8">#</th>
              <th className="text-left px-4 py-2.5">Team</th>
              <th className="text-center px-3 py-2.5 w-12">W</th>
              <th className="text-center px-3 py-2.5 w-12">L</th>
              <th className="text-center px-3 py-2.5 w-12">GP</th>
              <th className="text-right px-2 sm:px-4 py-2.5 w-14 sm:w-16">Win %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-600">
                  {query.trim() ? <>No teams match &ldquo;{query}&rdquo;</> : "No standings yet — no games have been played."}
                </td>
              </tr>
            ) : (
              filtered.map((team, i) => {
                const winPct = team.gp > 0 ? (team.wins / team.gp) * 100 : 0;
                const isFirst = i === 0 && !query.trim();
                const isMine = !!highlightTeamId && team.id === highlightTeamId;
                return (
                  <tr
                    key={team.id}
                    className={`${isMine ? "bg-indigo-900/30 shadow-[inset_3px_0_0_0_var(--color-indigo-400)]" : isFirst ? "bg-amber-900/10" : ""}`}
                  >
                    <td className="px-4 py-3 text-zinc-500 tabular-nums text-xs">
                      {isFirst ? "🥇" : i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {team.logo_url ? (
                          <img src={team.logo_url} alt="" className="w-5 h-5 rounded shrink-0 object-cover" />
                        ) : (
                          <div className="w-5 h-5 rounded shrink-0 bg-zinc-800 border border-zinc-700" />
                        )}
                        <span
                          title={team.name}
                          className={`font-medium truncate max-w-[150px] sm:max-w-[280px] ${isFirst ? "text-amber-300" : "text-white"}`}
                        >
                          {team.name}
                        </span>
                        {isMine && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-indigo-300 bg-indigo-500/20 border border-indigo-500/40 rounded px-1.5 py-0.5">
                            You
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-emerald-400 tabular-nums">
                      {team.wins}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-red-400 tabular-nums">
                      {team.losses}
                    </td>
                    <td className="px-3 py-3 text-center text-zinc-400 tabular-nums">
                      {team.gp}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden hidden sm:block">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${winPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-zinc-400 tabular-nums w-9 text-right">
                          {winPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
