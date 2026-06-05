"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTeam, removePlayerFromTeam, movePlayerToTeam } from "./actions";
import { MyTeamEditor } from "./my-team-editor";

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
};
type Player = {
  id: string; username: string; discord_id: string | null; avatar: string | null;
  peak_2v2: string; peak_3v3: string; tracker_url: string;
  is_captain: boolean | null; team_id: string | null;
};

interface Props {
  teams: Team[];
  byTeam: Record<string, Player[]>;
  avgMmr: Record<string, number>;
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

export function AdminTeamsManager({ teams, byTeam, avgMmr, initialQuery = "" }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDeleteTeamId, setConfirmDeleteTeamId] = useState<string | null>(null);
  const [confirmDeletePlayerId, setConfirmDeletePlayerId] = useState<string | null>(null);
  const [dragPlayerId, setDragPlayerId] = useState<string | null>(null);
  const [dragOverTeamId, setDragOverTeamId] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);

  const visibleTeams = query.trim()
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

  function handleDeleteTeam(teamId: string) {
    startTransition(async () => {
      await deleteTeam(teamId);
      setConfirmDeleteTeamId(null);
      router.refresh();
    });
  }

  function handleDeletePlayer(playerId: string) {
    startTransition(async () => {
      await removePlayerFromTeam(playerId);
      setConfirmDeletePlayerId(null);
      router.refresh();
    });
  }

  function handleDrop(targetTeamId: string) {
    if (!dragPlayerId) return;
    setDragOverTeamId(null);
    startTransition(async () => {
      await movePlayerToTeam(dragPlayerId, targetTeamId);
      setDragPlayerId(null);
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {visibleTeams.map((team) => {
        const roster = byTeam[team.id] ?? [];
        const offsetX = team.logo_offset_x ?? 50;
        const offsetY = team.logo_offset_y ?? 50;
        const isDropTarget = dragOverTeamId === team.id;
        const isConfirmingDelete = confirmDeleteTeamId === team.id;

        return (
          <div
            key={team.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverTeamId(team.id); }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverTeamId(null);
              }
            }}
            onDrop={() => handleDrop(team.id)}
            className={`rounded-xl border transition-colors ${
              isDropTarget
                ? "border-indigo-500 bg-indigo-950/30"
                : "border-zinc-800 bg-zinc-900"
            }`}
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
                  avg {(avgMmr[team.id] ?? 0).toLocaleString()} MMR
                  {team.is_locked && <span className="ml-2 text-amber-400">🔒</span>}
                </p>
              </div>

              {/* Trash / confirm delete */}
              {isConfirmingDelete ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-zinc-400">Delete team?</span>
                  <button
                    onClick={() => handleDeleteTeam(team.id)}
                    disabled={isPending}
                    className="px-2 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDeleteTeamId(null)}
                    className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteTeamId(team.id)}
                  className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors rounded-lg hover:bg-zinc-800 shrink-0"
                  title="Delete team"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Roster */}
            <div className="divide-y divide-zinc-800">
              {roster.length === 0 ? (
                <p className="px-5 py-3 text-sm text-zinc-600 italic">No players yet.</p>
              ) : (
                roster.map((player) => {
                  const peak = Math.max(Number(player.peak_2v2) || 0, Number(player.peak_3v3) || 0);
                  const isConfirmingPlayerDelete = confirmDeletePlayerId === player.id;

                  return (
                    <div
                      key={player.id}
                      draggable
                      onDragStart={(e) => {
                        setDragPlayerId(player.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => { setDragPlayerId(null); setDragOverTeamId(null); }}
                      className={`flex items-center gap-3 px-5 py-3 group transition-colors cursor-grab active:cursor-grabbing ${
                        dragPlayerId === player.id ? "opacity-40" : "hover:bg-zinc-800"
                      }`}
                    >
                      {/* Drag handle */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-600 group-hover:text-zinc-400 shrink-0">
                        <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                        <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                      </svg>

                      {player.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`}
                          alt="" width={28} height={28}
                          className="w-7 h-7 rounded-full shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
                      )}

                      <span className="flex-1 text-sm text-zinc-200 truncate">
                        {player.username}
                        {player.is_captain && <span className="ml-1.5 text-xs font-semibold text-yellow-400">C</span>}
                      </span>
                      <span className="text-xs text-zinc-500 shrink-0">{peak.toLocaleString()}</span>

                      {/* Delete player */}
                      {isConfirmingPlayerDelete ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleDeletePlayer(player.id)}
                            disabled={isPending}
                            className="px-2 py-0.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold rounded"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeletePlayerId(null)}
                            className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeletePlayerId(player.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-all rounded"
                          title="Remove from team"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
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
    </div>
  );
}
