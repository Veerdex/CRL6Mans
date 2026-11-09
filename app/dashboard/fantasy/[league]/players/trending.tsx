"use client";

import { use, useMemo } from "react";
import type { PoolPlayer, PoolView } from "@/app/lib/fantasy-pool-data";
import { TIER_LABEL, TIER_NAME_CLASS, trendingByTier, type FantasyTier } from "@/app/lib/fantasy-pool";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { TierBadge } from "./pool-table";

const fmt = (n: number) => n.toFixed(1);

export function TrendingPlayers({ pool }: { pool: Promise<PoolView> }) {
  const { players } = use(pool);
  const trend = useMemo(() => trendingByTier(players), [players]);
  if (!trend[1].length && !trend[2].length && !trend[3].length) return null;

  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl">
      <header className="px-4 py-3 border-b border-zinc-700 text-center">
        <h2 className="text-sm font-semibold text-white">Trending</h2>
        <p className="text-xs text-zinc-400">Who beat their projection by the most in their last series, per tier.</p>
      </header>
      <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-700/60">
        {([1, 2, 3] as FantasyTier[]).map((tier) => (
          <div key={tier} className="p-3 space-y-2">
            <div className="flex justify-center">
              <TierBadge tier={tier} />
            </div>
            {trend[tier].length ? (
              trend[tier].map(({ player, multiplier }) => <TrendRow key={player.id} player={player} multiplier={multiplier} />)
            ) : (
              <p className="text-xs text-zinc-500 text-center">No {TIER_LABEL[tier]} has played a series yet.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TrendRow({ player, multiplier }: { player: PoolPlayer; multiplier: number }) {
  const s = player.lastSeries!;
  const status = player.manager ? player.manager.name : player.waiverClearsAt ? "On waivers" : "Free agent";
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-zinc-900/60 px-2.5 py-2">
      <PlayerAvatar discordId={player.discordId} avatar={player.avatar} username={player.username} className="w-8 h-8" cdnSize={64} />
      <div className="flex-1 min-w-0">
        <div className="flex whitespace-nowrap">
          <PlayerName
            displayName={player.name}
            username={player.username}
            discordId={player.discordId || null}
            className={`text-sm font-medium truncate ${TIER_NAME_CLASS[player.tier]}`}
          />
        </div>
        <p className="text-xs text-zinc-400 truncate">
          {fmt(s.points)} pts vs {fmt(s.projected)} proj · {status}
        </p>
      </div>
      <span className={`shrink-0 text-sm font-bold tabular-nums ${multiplier >= 1 ? "text-emerald-400" : "text-zinc-300"}`}>
        {multiplier.toFixed(1)}×
      </span>
    </div>
  );
}
