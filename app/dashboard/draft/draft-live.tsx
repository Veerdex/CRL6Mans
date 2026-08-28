"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { triggerAutoPick } from "@/app/dashboard/draft-actions";
import { PlayerName } from "@/app/dashboard/player-name";

type Team = { id: string; name: string; rosterSize: number; isOnClock: boolean };
type Player = { id: string; username: string; display_name?: string | null; rv: number };

interface DraftLiveProps {
  numTeams: number;
  currentPick: number;
  totalPicks: number;
  pickDeadline: string | null;
  teams: Team[];
  availablePlayers: Player[];
  pickQueue: { pick: number; teamNum: number; isCurrent: boolean }[];
  viewerTeamId: string | null;
  userIsAdmin: boolean;
  sponsoredByLine?: ReactNode;
}

function useCountdown(deadline: string | null) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) { setSeconds(null); return; }
    const tick = () => setSeconds(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return seconds;
}

export function DraftLive({
  numTeams, currentPick, totalPicks,
  pickDeadline, teams, availablePlayers, pickQueue, viewerTeamId, userIsAdmin, sponsoredByLine,
}: DraftLiveProps) {
  const router = useRouter();
  const secondsLeft = useCountdown(pickDeadline);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  const deadlineRef = useRef<string | null>(null);
  const firedRef = useRef<string | null>(null);
  useEffect(() => { deadlineRef.current = pickDeadline; }, [pickDeadline]);

  useEffect(() => {
    const id = setInterval(() => {
      const dl = deadlineRef.current;
      if (!dl || firedRef.current === dl) return;
      if (new Date(dl).getTime() - Date.now() > 0) return;
      firedRef.current = dl;
      triggerAutoPick().then(res => console.log("[autopick] triggered, done=", res.done));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const onClockTeam = teams.find(t => t.isOnClock);
  const sortedTeams = [...teams].sort((a, b) => {
    const na = parseInt(a.name.replace("Team ", ""));
    const nb = parseInt(b.name.replace("Team ", ""));
    return na - nb;
  });

  const timerColor = secondsLeft !== null && secondsLeft <= 10
    ? "text-red-400"
    : secondsLeft !== null && secondsLeft <= 20
      ? "text-amber-400"
      : "text-zinc-400";

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Live Draft</h1>
            {sponsoredByLine}
          </div>
          <p className="text-sm text-zinc-400 mt-0.5">
            Pick {currentPick + 1} of {totalPicks} · {numTeams} teams
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold bg-blue-900/30 border-blue-700/50 text-blue-300">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Snake Draft
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 items-start">

        {/* Left: On-clock card + available players */}
        <div className="col-span-2 space-y-5">

          {/* On-clock card */}
          <div className="rounded-xl border p-5 space-y-4 bg-blue-950/20 border-blue-800/40">
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">On the clock</p>
              <p className="text-white font-medium">
                <span className="text-blue-300 font-bold">
                  {onClockTeam?.name ?? `Team ${pickQueue[0]?.teamNum ?? "?"}`}
                </span>
                {" "}is picking
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Use <code className="bg-zinc-800 px-1 rounded">/pick &lt;player&gt;</code> in Discord
                {userIsAdmin && " · Autocomplete shows available players"}
              </p>
            </div>

            {secondsLeft !== null && (
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={timerColor}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span className={`text-sm font-mono font-medium ${timerColor}`}>{secondsLeft}s</span>
                <span className="text-xs text-zinc-600">until auto-pick</span>
              </div>
            )}
          </div>

          {/* Available players */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Draft Pool</p>
              <span className="text-xs text-zinc-500">{availablePlayers.length} remaining</span>
            </div>
            {availablePlayers.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-500">No players remaining.</p>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {availablePlayers.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="text-zinc-600 tabular-nums w-5 text-right text-xs">{i + 1}</span>
                    <span className="flex-1 font-medium text-white">
                      <PlayerName displayName={p.display_name ?? null} username={p.username} />
                    </span>
                    <span className="text-zinc-400 tabular-nums text-xs">RV {p.rv}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Team rosters + pick queue */}
        <div className="space-y-5">

          {/* Team rosters */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Teams</p>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {sortedTeams.map(team => {
                const isViewer = team.id === viewerTeamId;
                return (
                  <div key={team.id} className={`px-4 py-3 ${team.isOnClock ? "bg-blue-900/20" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-semibold ${isViewer ? "text-indigo-300" : "text-white"}`}>
                        {team.name}
                        {isViewer && <span className="text-[10px] text-indigo-400 ml-1.5 font-normal">you</span>}
                        {team.isOnClock && <span className="text-[10px] text-blue-400 ml-1.5 font-normal">on clock</span>}
                      </span>
                      <span className="text-xs text-zinc-400">{team.rosterSize}/3</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pick queue */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Pick Order</p>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {pickQueue.map(({ pick, teamNum, isCurrent }) => (
                <div key={pick} className={`flex items-center gap-3 px-4 py-2.5 ${isCurrent ? "bg-blue-900/20" : ""}`}>
                  <span className="text-xs text-zinc-600 tabular-nums w-4">#{pick + 1}</span>
                  <span className={`text-sm font-medium ${isCurrent ? "text-blue-300" : "text-zinc-300"}`}>
                    Team {teamNum}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto text-[10px] font-semibold text-blue-400 uppercase tracking-wider">now</span>
                  )}
                </div>
              ))}
              {currentPick + pickQueue.length < totalPicks && (
                <div className="px-4 py-2 text-xs text-zinc-600">
                  +{totalPicks - currentPick - pickQueue.length} more picks…
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
