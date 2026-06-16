"use client";

import type { Player } from "@/app/lib/players";
import { PlayerName } from "@/app/dashboard/player-name";

export type StatAgg = {
  games: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
};

export function PlayerStatsModal({
  player,
  teamName,
  rvRank,
  totalPlayers,
  stats,
  onClose,
}: {
  player: Player;
  teamName: string | null;
  rvRank: number;
  totalPlayers: number;
  stats: StatAgg | undefined;
  onClose: () => void;
}) {
  const rv = Math.round(
    (Number(player.peak_2v2) + Number(player.current_2v2)) * 0.3 +
      (Number(player.peak_3v3) + Number(player.current_3v3)) * 0.2,
  );

  const games = stats?.games ?? 0;
  const perGame = (n: number) => (games ? n / games : 0);
  const shootingPct = stats && stats.shots > 0 ? (stats.goals / stats.shots) * 100 : null;
  const mvp =
    stats && games
      ? (stats.goals + stats.assists + stats.saves + stats.shots / 10) / (games * 4) + stats.score / 1000
      : 0;

  const avatarUrl = player.avatar
    ? `https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const mmr = [
    { label: "All Time Peak 2v2", value: Number(player.peak_2v2) },
    { label: "Season Peak 2v2", value: Number(player.current_2v2) },
    { label: "All Time Peak 3v3", value: Number(player.peak_3v3) },
    { label: "Season Peak 3v3", value: Number(player.current_3v3) },
  ];

  const statRows = stats
    ? [
        { label: "Goals", total: stats.goals },
        { label: "Assists", total: stats.assists },
        { label: "Saves", total: stats.saves },
        { label: "Shots", total: stats.shots },
        { label: "Score", total: stats.score },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-800/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt="" width={44} height={44} className="rounded-full shrink-0" />
          <div className="min-w-0 flex-1">
            <PlayerName
              displayName={player.display_name ?? null}
              username={player.username}
              className="text-lg font-bold text-white"
            />
            <p className="text-xs text-zinc-400 mt-0.5">
              {teamName ? teamName : <span className="italic text-zinc-500">Free Agent</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-2xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Ranking */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Ranking</h3>
            <div className="flex items-stretch gap-3">
              <div className="flex-1 bg-indigo-950/40 border border-indigo-700/40 rounded-xl px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-indigo-400">Rank Value</p>
                <p className="text-2xl font-bold font-mono text-white mt-0.5">{rv.toLocaleString()}</p>
              </div>
              <div className="flex-1 bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">RV Rank</p>
                <p className="text-2xl font-bold font-mono text-white mt-0.5">
                  #{rvRank}
                  <span className="text-sm text-zinc-500 font-normal"> / {totalPlayers}</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mmr.map((m) => (
                <div key={m.label} className="bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-zinc-500">{m.label}</p>
                  <p className="text-sm font-mono font-semibold text-zinc-200">{m.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Performance */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Performance — This Event</h3>
            {games === 0 ? (
              <p className="text-sm text-zinc-500 bg-zinc-800/40 border border-zinc-800 rounded-lg px-4 py-6 text-center">
                No replay stats recorded yet.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Games" value={String(games)} />
                  <StatCard label="MVP Rating" value={mvp.toFixed(3)} accent />
                  <StatCard label="Shooting %" value={shootingPct === null ? "—" : `${shootingPct.toFixed(1)}%`} />
                </div>
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-zinc-500 text-left border-b border-zinc-800 bg-zinc-800/40">
                        <th className="px-4 py-2 font-medium">Stat</th>
                        <th className="px-4 py-2 font-medium text-right">Total</th>
                        <th className="px-4 py-2 font-medium text-right">Per Game</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statRows.map((row) => (
                        <tr key={row.label} className="border-b border-zinc-800 last:border-0">
                          <td className="px-4 py-2 text-zinc-300">{row.label}</td>
                          <td className="px-4 py-2 text-right font-mono text-white">{row.total.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right font-mono text-zinc-400">{perGame(row.total).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <p className="text-[11px] text-zinc-600">Performance reflects the current event. Demos aren&apos;t tracked.</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl px-3 py-2.5 border text-center ${
        accent ? "bg-amber-950/30 border-amber-700/40" : "bg-zinc-800/60 border-zinc-700"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-lg font-bold font-mono mt-0.5 ${accent ? "text-amber-300" : "text-white"}`}>{value}</p>
    </div>
  );
}
