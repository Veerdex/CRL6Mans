"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { triggerAutoPick } from "@/app/dashboard/draft-actions";

type Team = {
  id: string; name: string; credits: number; rosterSize: number;
  isLeading: boolean; isOnClock: boolean;
};

type Player = { id: string; username: string; rv: number };

interface DraftLiveProps {
  phase: "nomination" | "bidding";
  numTeams: number;
  currentPick: number;
  totalPicks: number;
  nominatedPlayerName: string | null;
  nominatedPlayerRv: number | null;
  currentBid: number | null;
  leadingTeamName: string | null;
  pickDeadline: string | null;
  teams: Team[];
  availablePlayers: Player[];
  nominationQueue: { pick: number; teamNum: number; isCurrent: boolean }[];
  viewerTeamId: string | null;
  userIsAdmin: boolean;
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
  phase, numTeams, currentPick, totalPicks,
  nominatedPlayerName, nominatedPlayerRv, currentBid, leadingTeamName,
  pickDeadline, teams, availablePlayers, nominationQueue, viewerTeamId, userIsAdmin,
}: DraftLiveProps) {
  const router = useRouter();
  const secondsLeft = useCountdown(pickDeadline);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  // Trigger autopick as soon as the nomination timer hits 0 — don't wait for the cron.
  // firedRef prevents double-firing if the component re-renders while secondsLeft is still 0.
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "nomination" || secondsLeft !== 0 || !pickDeadline) return;
    if (firedRef.current === pickDeadline) return;
    firedRef.current = pickDeadline;
    triggerAutoPick().then(() => router.refresh());
  }, [phase, secondsLeft, pickDeadline, router]);

  const roundNum = currentPick + 1;
  const isNomination = phase === "nomination";
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
    <div className="p-8 space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Draft</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Round {roundNum} of {totalPicks} · {numTeams} teams
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
          isNomination
            ? "bg-blue-900/30 border-blue-700/50 text-blue-300"
            : "bg-amber-900/30 border-amber-700/50 text-amber-300"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isNomination ? "bg-blue-400" : "bg-amber-400"} animate-pulse`} />
          {isNomination ? "Nomination Phase" : "Bidding Phase"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 items-start">

        {/* Left: Current auction + available players */}
        <div className="col-span-2 space-y-5">

          {/* Current auction card */}
          <div className={`rounded-xl border p-5 space-y-4 ${
            isNomination
              ? "bg-blue-950/20 border-blue-800/40"
              : "bg-amber-950/20 border-amber-800/40"
          }`}>
            {isNomination ? (
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Waiting for nomination</p>
                <p className="text-white font-medium">
                  <span className="text-blue-300 font-bold">
                    Team {nominationQueue[0]?.teamNum ?? "?"}
                  </span>
                  {" "}is on the clock
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Use <code className="bg-zinc-800 px-1 rounded">/nominate &lt;player&gt; &lt;bid&gt;</code> in Discord
                </p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Up for auction</p>
                  <p className="text-white text-lg font-bold">
                    {nominatedPlayerName ?? "—"}
                    {nominatedPlayerRv !== null && (
                      <span className="text-sm font-normal text-zinc-400 ml-2">RV {nominatedPlayerRv}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-end gap-6">
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Current bid</p>
                    <p className="text-2xl font-bold text-amber-300">{currentBid ?? 0} <span className="text-sm font-normal text-zinc-400">credits</span></p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Leading</p>
                    <p className="text-base font-semibold text-white">{leadingTeamName ?? "—"}</p>
                  </div>
                </div>
                <p className="text-xs text-zinc-500">
                  Use <code className="bg-zinc-800 px-1 rounded">/bid &lt;amount&gt;</code> in Discord to bid higher
                  {userIsAdmin && " · Admin: use "}
                  {userIsAdmin && <code className="bg-zinc-800 px-1 rounded">/endround</code>}
                  {userIsAdmin && " to close"}
                </p>
              </>
            )}

            {/* Timer */}
            {secondsLeft !== null && (
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={timerColor}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span className={`text-sm font-mono font-medium ${timerColor}`}>
                  {secondsLeft}s
                </span>
                <span className="text-xs text-zinc-600">
                  {isNomination ? "until auto-nomination" : "until auto-close"}
                </span>
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
                    <span className="flex-1 font-medium text-white">{p.username}</span>
                    <span className="text-zinc-400 tabular-nums text-xs">RV {p.rv}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Team budgets + queue */}
        <div className="space-y-5">

          {/* Team budgets */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Team Budgets</p>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {sortedTeams.map(team => {
                const stillNeeded = 3 - team.rosterSize;
                const reserve = Math.max(0, stillNeeded - 1);
                const maxBid = team.credits - reserve;
                const isViewer = team.id === viewerTeamId;
                return (
                  <div key={team.id} className={`px-4 py-3 ${
                    team.isLeading ? "bg-amber-900/20" : team.isOnClock ? "bg-blue-900/20" : ""
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-semibold ${
                        isViewer ? "text-indigo-300" : "text-white"
                      }`}>
                        {team.name}
                        {isViewer && <span className="text-[10px] text-indigo-400 ml-1.5 font-normal">you</span>}
                        {team.isOnClock && <span className="text-[10px] text-blue-400 ml-1.5 font-normal">on clock</span>}
                        {team.isLeading && <span className="text-[10px] text-amber-400 ml-1.5 font-normal">leading</span>}
                      </span>
                      <span className="text-sm font-bold text-white tabular-nums">{team.credits}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>{team.rosterSize}/3 players</span>
                      <span>max {maxBid}</span>
                    </div>
                    {/* Credit bar */}
                    <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          team.credits > 500 ? "bg-emerald-500" :
                          team.credits > 200 ? "bg-amber-500" : "bg-red-500"
                        }`}
                        style={{ width: `${Math.min(100, (team.credits / 1000) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Nomination queue */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Nomination Order</p>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {nominationQueue.map(({ pick, teamNum, isCurrent }) => (
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
              {currentPick + nominationQueue.length < totalPicks && (
                <div className="px-4 py-2 text-xs text-zinc-600">
                  +{totalPicks - currentPick - nominationQueue.length} more rounds…
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
