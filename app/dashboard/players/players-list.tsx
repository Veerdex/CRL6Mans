"use client";

import { useState, useMemo } from "react";
import type { Player } from "@/app/lib/players";
import { playerRatingFromRow } from "@/app/lib/rating";
import { PlayerName } from "@/app/dashboard/player-name";
import { PlayerStatsModal, type StatAgg } from "./player-stats-modal";

export default function PlayersList({
  players,
  teamNames,
  statsByPlayer,
}: {
  players: Player[];
  teamNames: Record<string, string>;
  statsByPlayer: Record<string, StatAgg>;
}) {
  const [search, setSearch] = useState("");
  const [statsFor, setStatsFor] = useState<Player | null>(null);

  const rankMap = useMemo(
    () => new Map(players.map((p, i) => [p.id, i + 1])),
    [players]
  );

  const filtered = search
    ? players.filter((p) => {
        const term = search.toLowerCase();
        return (
          p.username.toLowerCase().includes(term) ||
          (p.display_name ?? "").toLowerCase().includes(term)
        );
      })
    : players;

  return (
    <div className="space-y-4">
      <input
        type="search"
        placeholder="Search players..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-4 py-2 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-left">
              <th className="px-4 py-3 font-medium w-12">#</th>
              <th className="px-4 py-3 font-medium">Player</th>
              <th className="px-4 py-3 font-medium hidden sm:table-cell">Team</th>
              <th className="px-4 py-3 font-medium text-right">Rank Value</th>
              <th className="px-4 py-3 font-medium text-right hidden md:table-cell">AT Peak 2v2</th>
              <th className="px-4 py-3 font-medium text-right hidden md:table-cell">AT Peak 3v3</th>
              <th className="px-4 py-3 font-medium text-right w-20"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No players found.
                </td>
              </tr>
            ) : (
              filtered.map((player) => {
                const rank = rankMap.get(player.id) ?? 0;
                const rv = Math.round(playerRatingFromRow(player));
                const avatarUrl = player.avatar
                  ? `https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`
                  : `https://cdn.discordapp.com/embed/avatars/0.png`;

                return (
                  <tr
                    key={player.id}
                    className="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-zinc-500 font-mono">
                      {rank}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={avatarUrl}
                          alt=""
                          width={28}
                          height={28}
                          className="rounded-full shrink-0"
                        />
                        <a
                          href={player.tracker_url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 font-medium text-white hover:text-indigo-400 transition-colors"
                        >
                          <PlayerName
                            displayName={player.display_name ?? null}
                            username={player.username}
                            className="max-w-[150px] sm:max-w-[300px]"
                          />
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {player.team_id && teamNames[player.team_id] ? (
                        <span className="text-zinc-200">{teamNames[player.team_id]}</span>
                      ) : (
                        <span className="text-zinc-500 italic">Free Agent</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-white font-mono font-semibold">
                      {rv.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-mono hidden md:table-cell">
                      {Number(player.peak_2v2).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-mono hidden md:table-cell">
                      {Number(player.peak_3v3).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setStatsFor(player)}
                        className="px-3 py-1 bg-zinc-700 hover:bg-indigo-600 text-zinc-200 hover:text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        Stats
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {statsFor && (
        <PlayerStatsModal
          player={statsFor}
          teamName={statsFor.team_id ? (teamNames[statsFor.team_id] ?? null) : null}
          rvRank={rankMap.get(statsFor.id) ?? 0}
          totalPlayers={players.length}
          stats={statsByPlayer[statsFor.id] ?? null}
          onClose={() => setStatsFor(null)}
        />
      )}
    </div>
  );
}
