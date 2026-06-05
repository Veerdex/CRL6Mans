"use client";

import { useState } from "react";

type Team = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_offset_x: number | null;
  logo_offset_y: number | null;
  is_locked: boolean | null;
};

type Player = {
  id: string;
  username: string;
  discord_id: string | null;
  avatar: string | null;
  peak_2v2: string;
  peak_3v3: string;
  tracker_url: string;
  is_captain: boolean | null;
};

interface Props {
  teams: Team[];
  byTeam: Record<string, Player[]>;
  avgMmr: Record<string, number>;
  myTeamId?: string | null;
  initialQuery?: string;
}

const gradients = [
  "from-indigo-600 to-indigo-800", "from-rose-600 to-rose-800",
  "from-emerald-600 to-emerald-800", "from-amber-600 to-amber-800",
  "from-cyan-600 to-cyan-800", "from-purple-600 to-purple-800",
  "from-orange-600 to-orange-800", "from-teal-600 to-teal-800",
];

function DefaultLogo({ name }: { name: string }) {
  const num = name.replace(/\D+/g, "");
  const g = gradients[(parseInt(num) - 1) % gradients.length] ?? gradients[0];
  return (
    <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${g} flex items-center justify-center text-white font-bold text-lg shrink-0`}>
      {num}
    </div>
  );
}

export function TeamsGrid({ teams, byTeam, avgMmr, myTeamId, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);

  const filtered = query.trim()
    ? (() => {
        const q = query.trim();
        const re = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return teams.filter(
          (t) =>
            re.test(t.name) ||
            (byTeam[t.id] ?? []).some((p) =>
              p.username.toLowerCase().includes(q.toLowerCase())
            )
        );
      })()
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
            const roster = byTeam[team.id] ?? [];
            const offsetX = team.logo_offset_x ?? 50;
            const offsetY = team.logo_offset_y ?? 50;
            const isMyTeam = team.id === myTeamId;
            return (
              <div
                key={team.id}
                className={`bg-zinc-900 border rounded-xl overflow-hidden ${
                  isMyTeam ? "border-indigo-500/60 ring-1 ring-indigo-500/30" : "border-zinc-800"
                }`}
              >
                <div className="p-5 flex items-center gap-4 border-b border-zinc-800">
                  {team.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={team.logo_url}
                      alt={team.name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-lg object-cover shrink-0"
                      style={{ objectPosition: `${offsetX}% ${offsetY}%` }}
                    />
                  ) : (
                    <DefaultLogo name={team.name} />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-white truncate">{team.name}</h2>
                      {isMyTeam && (
                        <span className="text-[10px] font-bold text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded shrink-0">
                          MY TEAM
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      avg {(avgMmr[team.id] ?? 0).toLocaleString()} MMR
                      {team.is_locked && <span className="ml-2 text-amber-400">🔒</span>}
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-zinc-800">
                  {roster.length === 0 ? (
                    <p className="px-5 py-3 text-sm text-zinc-600 italic">No players yet.</p>
                  ) : (
                    roster.map((player) => {
                      const peak = Math.max(Number(player.peak_2v2) || 0, Number(player.peak_3v3) || 0);
                      return (
                        <a
                          key={player.id}
                          href={player.tracker_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-800 transition-colors group"
                        >
                          {player.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`}
                              alt=""
                              width={28}
                              height={28}
                              className="w-7 h-7 rounded-full shrink-0"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
                          )}
                          <span className="flex-1 text-sm text-zinc-200 group-hover:text-white transition-colors truncate">
                            {player.username}
                            {player.is_captain && (
                              <span className="ml-1.5 text-xs font-semibold text-yellow-400">C</span>
                            )}
                          </span>
                          <span className="text-xs text-zinc-500 shrink-0">{peak.toLocaleString()}</span>
                        </a>
                      );
                    })
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
