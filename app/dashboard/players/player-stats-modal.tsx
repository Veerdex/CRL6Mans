"use client";

import type { Player } from "@/app/lib/players";
import { playerRatingFromRow } from "@/app/lib/rating";
import { PlayerName } from "@/app/dashboard/player-name";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

export type StatAgg = {
  games: number;
  totalGoals: number;
  totalAssists: number;
  totalSaves: number;
  totalShots: number;
  totalScore: number;
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-mono font-semibold text-zinc-200">{value}</p>
    </div>
  );
}

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
  stats?: StatAgg | null;
  onClose: () => void;
}) {
  const rv = Math.round(playerRatingFromRow(player));

  const mmr = [
    { label: "All Time Peak 2v2", value: Number(player.peak_2v2) },
    { label: "Season Peak 2v2", value: Number(player.current_2v2) },
    { label: "All Time Peak 3v3", value: Number(player.peak_3v3) },
    { label: "Season Peak 3v3", value: Number(player.current_3v3) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-800/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <PlayerAvatar discordId={player.discord_id} avatar={player.avatar} username={player.username} className="w-11 h-11" />
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
          {stats && stats.games > 0 && (() => {
            const g = stats.games;
            const perGame = (n: number) => (n / g).toFixed(2);
            const shootingPct = stats.totalShots > 0
              ? ((stats.totalGoals / stats.totalShots) * 100).toFixed(1) + "%"
              : "—";
            const mvp = (
              (stats.totalGoals + stats.totalAssists + stats.totalSaves + stats.totalShots / 10) / (g * 4) +
              stats.totalScore / 1000
            ).toFixed(3);
            const statRows = [
              { label: "Goals / Game",   value: perGame(stats.totalGoals) },
              { label: "Assists / Game", value: perGame(stats.totalAssists) },
              { label: "Saves / Game",   value: perGame(stats.totalSaves) },
              { label: "Shots / Game",   value: perGame(stats.totalShots) },
              { label: "Shooting %",     value: shootingPct },
              { label: "MVP Rating",     value: mvp },
            ];
            return (
              <section className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Performance — This Event</h3>
                  <span className="text-[11px] text-zinc-600">{g} game{g !== 1 ? "s" : ""}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {statRows.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
                </div>
              </section>
            );
          })()}

        </div>
      </div>
    </div>
  );
}

