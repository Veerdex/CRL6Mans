"use client";

import { useState } from "react";
import { PlayerName } from "./player-name";

export type TeamRatingMember = {
  playerId: string;
  discordId: string | null;
  username: string;
  displayName: string | null;
  rating: number;
  status: "invited" | "accepted";
};

export type TeamRatingRow = {
  id: string;
  name: string;
  rating: number;
  members: TeamRatingMember[];
};

export function TeamRatingList({ teams }: { teams: TeamRatingRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      {teams.map((t, i) => (
        <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === t.id ? null : t.id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800/60 transition-colors"
          >
            <span className="text-xs text-zinc-600 w-5 shrink-0">{i + 1}</span>
            <span className="text-white flex-1 truncate">{t.name}</span>
            <span className="text-amber-400 font-medium tabular-nums text-xs">{Math.round(t.rating)}</span>
            <span className={`text-zinc-500 text-xs transition-transform ${expanded === t.id ? "rotate-180" : ""}`}>▾</span>
          </button>
          {expanded === t.id && (
            <div className="px-3 pb-2 pt-1 border-t border-zinc-800 space-y-1">
              {t.members
                .slice()
                .sort((a, b) => b.rating - a.rating)
                .map((m) => (
                  <div key={m.playerId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <PlayerName displayName={m.displayName} username={m.username} discordId={m.discordId} className="text-zinc-300" />
                      {m.status === "invited" && (
                        <span className="text-[9px] font-medium text-amber-400 bg-amber-400/10 px-1 py-0.5 rounded shrink-0">PENDING</span>
                      )}
                    </span>
                    <span className="text-zinc-500 tabular-nums shrink-0">{Math.round(m.rating)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
