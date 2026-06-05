"use client";

import { useState, useMemo } from "react";
import type { Player } from "@/app/lib/players";

export default function PlayersList({
  players,
  teamNames,
}: {
  players: Player[];
  teamNames: Record<string, string>;
}) {
  const [search, setSearch] = useState("");

  const rankMap = useMemo(
    () => new Map(players.map((p, i) => [p.id, i + 1])),
    [players]
  );

  const filtered = search
    ? players.filter((p) =>
        p.username.toLowerCase().includes(search.toLowerCase())
      )
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
              <th className="px-4 py-3 font-medium">Team</th>
              <th className="px-4 py-3 font-medium text-right">Peak 2v2</th>
              <th className="px-4 py-3 font-medium text-right">Peak 3v3</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No players found.
                </td>
              </tr>
            ) : (
              filtered.map((player) => {
                const rank = rankMap.get(player.id) ?? 0;
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
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={avatarUrl}
                          alt=""
                          width={28}
                          height={28}
                          className="rounded-full shrink-0"
                        />
                        <a
                          href={player.tracker_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-white hover:text-indigo-400 transition-colors"
                        >
                          {player.username}
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {player.team_id && teamNames[player.team_id] ? (
                        <span className="text-zinc-200">{teamNames[player.team_id]}</span>
                      ) : (
                        <span className="text-zinc-500 italic">Free Agent</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-mono">
                      {player.peak_2v2}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-mono">
                      {player.peak_3v3}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
