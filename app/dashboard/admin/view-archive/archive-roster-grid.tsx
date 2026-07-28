"use client";

import { useState } from "react";
import { PlayerName } from "@/app/dashboard/player-name";
import type { TournamentArchive } from "../tournament-archive";

// Roster/logo card grid in the style of TeamsGrid (app/dashboard/teams/teams-grid.tsx),
// but fed from the archive's denormalized roster snapshot (username/rating only —
// no discord_id/avatar/tracker_url, since those weren't captured at export time).
export function ArchiveRosterGrid({ teams }: { teams: TournamentArchive["teams"] }) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? teams.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.roster.some((p) =>
            p.username.toLowerCase().includes(query.toLowerCase()) ||
            (p.displayName ?? "").toLowerCase().includes(query.toLowerCase())
          )
      )
    : teams;

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search teams or players…"
        className="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm">No teams match &quot;{query}&quot;.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((team) => {
            const roster = [...team.roster].sort((a, b) => b.rating - a.rating);
            const avgRating = roster.length
              ? Math.round(roster.reduce((sum, p) => sum + p.rating, 0) / roster.length)
              : 0;
            return (
              <div key={team.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="p-5 flex items-center gap-4 border-b border-zinc-800">
                  {team.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.logoUrl} alt={team.name} width={48} height={48}
                      className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-800 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-white truncate">{team.name}</h2>
                    <p className="text-xs text-zinc-500">
                      {team.wins}-{team.losses} · avg {avgRating.toLocaleString()} RV
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-zinc-800">
                  {roster.length === 0 ? (
                    <p className="px-5 py-3 text-sm text-zinc-600 italic">No players recorded.</p>
                  ) : (
                    roster.map((player) => (
                      <div key={player.username} className="flex items-center gap-3 px-5 py-3">
                        <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
                        <span className="flex-1 text-sm text-zinc-200 truncate">
                          <PlayerName displayName={player.displayName} username={player.username} />
                          {player.isCaptain && (
                            <span className="ml-1.5 text-xs font-semibold text-yellow-400">C</span>
                          )}
                        </span>
                        <span className="text-xs text-zinc-500 shrink-0">{player.rating.toLocaleString()} <span className="text-zinc-700">RV</span></span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
