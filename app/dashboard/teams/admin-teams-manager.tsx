"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { swapPlayersBetweenTeams, swapRosterPlayerWithBenchPlayer, disqualifyTeam } from "./actions";
import { MyTeamEditor } from "./my-team-editor";
import { PlayerName } from "@/app/dashboard/player-name";
import { playerRatingFromRow } from "@/app/lib/rating";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

// Isolated per-card toggle so state can never bleed across cards.
function TeamEditToggleInline({ team }: { team: { id: string; name: string; logo_url: string | null; logo_offset_x: number | null; logo_offset_y: number | null; is_locked: boolean | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-2.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors text-left"
      >
        {open ? "↑ Close editor" : "Edit team info"}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <MyTeamEditor
            team={{ ...team, logo_offset_x: team.logo_offset_x ?? 50, logo_offset_y: team.logo_offset_y ?? 50, is_locked: team.is_locked ?? false }}
            isAdmin={true}
            label={team.name}
          />
        </div>
      )}
    </div>
  );
}

type Team = {
  id: string; name: string; logo_url: string | null;
  logo_offset_x: number | null; logo_offset_y: number | null; is_locked: boolean | null;
  is_disqualified?: boolean | null; disqualified_at?: string | null;
};
type Player = {
  id: string; username: string; display_name: string | null; discord_id: string | null; avatar: string | null;
  peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
  peak_1v1: string | null; current_1v1: string | null; tracker_url: string;
  is_captain: boolean | null; team_id: string | null;
};
type AvailablePlayer = {
  id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
  peak_1v1: string | null; current_1v1: string | null;
  team_id: string | null;
};

interface Props {
  teams: Team[];
  byTeam: Record<string, Player[]>;
  avgMmr: Record<string, number>;
  availablePlayers?: AvailablePlayer[];
  initialQuery?: string;
  joinMode?: "players" | "teams";
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

function rv(p: Parameters<typeof playerRatingFromRow>[0]) {
  return Math.round(playerRatingFromRow(p));
}

// Either a rostered player (tied to a team) or a bench player (no team yet).
type SwapSelection = { kind: "roster"; playerId: string; teamId: string; name: string } | { kind: "bench"; playerId: string; name: string };

function isValidTarget(source: SwapSelection, candidate: SwapSelection): boolean {
  if (source.playerId === candidate.playerId) return false;
  if (source.kind === "bench" && candidate.kind === "bench") return false;
  if (source.kind === "roster" && candidate.kind === "roster" && source.teamId === candidate.teamId) return false;
  return true;
}

export function AdminTeamsManager({ teams, byTeam, avgMmr, availablePlayers = [], initialQuery = "", joinMode = "players" }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDqTeamId, setConfirmDqTeamId] = useState<string | null>(null);
  const [dqConfirmText, setDqConfirmText] = useState("");
  const [swapSource, setSwapSource] = useState<SwapSelection | null>(null);
  const [swapTarget, setSwapTarget] = useState<SwapSelection | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);

  const swapEnabled = joinMode !== "teams";

  const visibleTeams = query.trim()
    ? (() => {
        const q = query.trim();
        const re = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return teams.filter(
          (t) =>
            re.test(t.name) ||
            (byTeam[t.id] ?? []).some((p) =>
              p.username.toLowerCase().includes(q.toLowerCase()) ||
              (p.display_name ?? "").toLowerCase().includes(q.toLowerCase())
            )
        );
      })()
    : teams;

  function handleDisqualify(teamId: string) {
    startTransition(async () => {
      await disqualifyTeam(teamId);
      setConfirmDqTeamId(null);
      setDqConfirmText("");
      router.refresh();
    });
  }

  function handleSelect(candidate: SwapSelection, teamDqd: boolean) {
    if (!swapEnabled || teamDqd) return;
    setSwapError(null);
    if (!swapSource) {
      setSwapSource(candidate);
      return;
    }
    if (swapSource.playerId === candidate.playerId) {
      setSwapSource(null);
      return;
    }
    if (!isValidTarget(swapSource, candidate)) {
      // Not a legal pairing with the current source — treat the new click as a
      // fresh selection instead of silently doing nothing.
      setSwapSource(candidate);
      return;
    }
    setSwapTarget(candidate);
  }

  function cancelSwap() {
    setSwapSource(null);
    setSwapTarget(null);
    setSwapError(null);
  }

  function confirmSwap() {
    if (!swapSource || !swapTarget) return;
    const source = swapSource;
    const target = swapTarget;
    startTransition(async () => {
      let result: { error?: string; success?: boolean };
      if (source.kind === "roster" && target.kind === "roster") {
        result = await swapPlayersBetweenTeams(source.playerId, target.playerId);
      } else if (source.kind === "roster" && target.kind === "bench") {
        result = await swapRosterPlayerWithBenchPlayer(source.playerId, target.playerId, source.teamId);
      } else {
        // bench source, roster target
        result = await swapRosterPlayerWithBenchPlayer((target as Extract<SwapSelection, { kind: "roster" }>).playerId, source.playerId, (target as Extract<SwapSelection, { kind: "roster" }>).teamId);
      }
      if (result.error) {
        setSwapError(result.error);
        setSwapTarget(null);
        return;
      }
      cancelSwap();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search teams or players…"
        className="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {visibleTeams.length === 0 && query.trim() && (
        <p className="text-zinc-500 text-sm">No teams match &quot;{query}&quot;.</p>
      )}

      {swapSource && !swapTarget && (
        <div className="flex items-center gap-3 bg-indigo-950/40 border border-indigo-800/50 rounded-lg px-4 py-2.5">
          <span className="text-sm text-indigo-300">
            Select a player to swap with <span className="font-semibold">{swapSource.name}</span>…
          </span>
          <button onClick={cancelSwap} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
        </div>
      )}

      {swapTarget && swapSource && (
        <div className="flex items-center gap-3 bg-indigo-950/40 border border-indigo-800/50 rounded-lg px-4 py-2.5">
          <span className="text-sm text-indigo-200">
            Swap <span className="font-semibold">{swapSource.name}</span> ↔ <span className="font-semibold">{swapTarget.name}</span>?
          </span>
          <button
            onClick={confirmSwap}
            disabled={isPending}
            className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
          >
            {isPending ? "Swapping…" : "Yes"}
          </button>
          <button onClick={cancelSwap} className="px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg">
            Cancel
          </button>
        </div>
      )}
      {swapError && <p className="text-xs text-red-400">{swapError}</p>}

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {visibleTeams.map((team) => {
        const roster = byTeam[team.id] ?? [];
        const offsetX = team.logo_offset_x ?? 50;
        const offsetY = team.logo_offset_y ?? 50;
        const isConfirmingDq = confirmDqTeamId === team.id;
        const isDqd = !!team.is_disqualified;

        return (
          <div
            key={team.id}
            className={`rounded-xl border border-zinc-800 bg-zinc-900 transition-opacity ${isDqd ? "opacity-60" : ""}`}
          >
            {/* Header */}
            <div className="p-5 flex items-center gap-4 border-b border-zinc-800 relative">
              {team.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={team.logo_url} alt={team.name} width={48} height={48}
                  className="w-12 h-12 rounded-lg object-cover shrink-0"
                  style={{ objectPosition: `${offsetX}% ${offsetY}%` }}
                />
              ) : (
                <DefaultLogo name={team.name} />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-white truncate">{team.name}</h2>
                <p className="text-xs text-zinc-500">
                  avg {(avgMmr[team.id] ?? 0).toLocaleString()} RV
                  {team.is_locked && <span className="ml-2 text-amber-400">🔒</span>}
                </p>
              </div>

              {/* Disqualify / DQ badge */}
              {isDqd ? (
                <span className="shrink-0 text-[10px] font-bold text-red-400 border border-red-800/50 bg-red-950/40 rounded px-2 py-1 uppercase tracking-wide">
                  Disqualified
                  {team.disqualified_at && (
                    <span className="block font-normal normal-case text-red-500/70 text-[9px] mt-0.5">
                      {new Date(team.disqualified_at).toLocaleDateString()}
                    </span>
                  )}
                </span>
              ) : isConfirmingDq ? (
                <button
                  onClick={() => { setConfirmDqTeamId(null); setDqConfirmText(""); }}
                  className="shrink-0 px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => { setConfirmDqTeamId(team.id); setDqConfirmText(""); }}
                  className="shrink-0 text-[10px] font-bold text-red-500 hover:text-red-400 border border-red-800/50 hover:border-red-600/60 rounded px-2 py-1 transition-colors uppercase tracking-wide"
                  title="Disqualify team"
                >
                  Disqualify
                </button>
              )}
            </div>

            {/* Disqualify confirmation — requires typing the team name to avoid mis-clicks */}
            {isConfirmingDq && (
              <div className="px-5 py-3 border-b border-zinc-800 bg-red-950/20 space-y-2">
                <p className="text-xs text-zinc-300">
                  Type <span className="font-semibold text-white">{team.name}</span> to confirm disqualification.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dqConfirmText}
                    onChange={(e) => setDqConfirmText(e.target.value)}
                    placeholder={team.name}
                    autoFocus
                    className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                  <button
                    onClick={() => handleDisqualify(team.id)}
                    disabled={isPending || dqConfirmText.trim().toLowerCase() !== team.name.trim().toLowerCase()}
                    className="shrink-0 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg"
                  >
                    {isPending ? "Disqualifying…" : "Disqualify"}
                  </button>
                </div>
              </div>
            )}

            {/* Roster */}
            <div className="divide-y divide-zinc-800">
              {roster.length === 0 ? (
                <p className="px-5 py-3 text-sm text-zinc-600 italic">No players yet.</p>
              ) : (
                roster.map((player) => {
                  const peak = rv(player);
                  const selection: SwapSelection = { kind: "roster", playerId: player.id, teamId: team.id, name: player.display_name ?? player.username };
                  const isSelected = swapSource?.playerId === player.id;
                  const clickable = swapEnabled && !isDqd;

                  return (
                    <div
                      key={player.id}
                      onClick={() => handleSelect(selection, isDqd)}
                      className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                        clickable ? "cursor-pointer hover:bg-zinc-800" : ""
                      } ${isSelected ? "bg-indigo-950/50 ring-1 ring-inset ring-indigo-600" : ""}`}
                    >
                      <PlayerAvatar discordId={player.discord_id} avatar={player.avatar} username={player.username} className="w-7 h-7" />

                      <span className="flex-1 text-sm text-zinc-200 min-w-0">
                        <a
                          href={player.tracker_url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-indigo-400 transition-colors"
                        >
                          <PlayerName displayName={player.display_name} username={player.username} />
                        </a>
                        {player.is_captain && <span className="ml-1.5 text-xs font-semibold text-yellow-400">C</span>}
                      </span>
                      <span className="text-xs text-zinc-500 shrink-0">{peak.toLocaleString()} <span className="text-zinc-700">RV</span></span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Edit team info toggle — per-card state, isolated from other cards */}
            <TeamEditToggleInline team={team} />
          </div>
        );
      })}
    </div>

      {/* Bench — players who entered the draft/tournament but aren't rostered yet */}
      {swapEnabled && availablePlayers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-300">Available Players</h3>
            <p className="text-xs text-zinc-500">Select a rostered player above, then one of these to swap them in.</p>
          </div>
          <div className="divide-y divide-zinc-800 max-h-72 overflow-y-auto">
            {availablePlayers.map((p) => {
              const peak = rv(p);
              const selection: SwapSelection = { kind: "bench", playerId: p.id, name: p.display_name ?? p.username };
              const isSelected = swapSource?.playerId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelect(selection, false)}
                  className={`flex items-center justify-between px-5 py-2.5 cursor-pointer hover:bg-zinc-800 transition-colors ${
                    isSelected ? "bg-indigo-950/50 ring-1 ring-inset ring-indigo-600" : ""
                  }`}
                >
                  <span className="text-sm text-zinc-300">{p.display_name ?? p.username}</span>
                  <span className="text-xs text-zinc-500">{peak.toLocaleString()} RV</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
