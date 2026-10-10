"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { swapPlayersBetweenTeams, swapRosterPlayerWithBenchPlayer, disqualifyTeam, addPlayerToEvent, removePlayerFromEvent, createTeam } from "./actions";
import { MyTeamEditor } from "./my-team-editor";
import { PlayerName } from "@/app/dashboard/player-name";
import { playerRatingFromRow } from "@/app/lib/rating";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { DefaultLogo } from "@/app/lib/team-logo";

// Isolated per-card toggle so state can never bleed across cards.
function TeamEditToggleInline({ team, teamSize }: { team: { id: string; name: string; logo_url: string | null; logo_offset_x: number | null; logo_offset_y: number | null; is_locked: boolean | null }; teamSize: number }) {
  const [open, setOpen] = useState(false);
  // A 1v1 team's name and logo are its player's, so there's nothing behind this.
  if (teamSize === 1) return null;
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
            teamSize={teamSize}
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
  sub_willing?: boolean | null;
  inEvent?: boolean;
};

interface Props {
  teams: Team[];
  byTeam: Record<string, Player[]>;
  teamRv: Record<string, number>;
  availablePlayers?: AvailablePlayer[];
  initialQuery?: string;
  joinMode?: "players" | "teams";
  teamSize?: number;
  lateEntriesOpen?: boolean;
}

function rv(p: Parameters<typeof playerRatingFromRow>[0]) {
  return Math.round(playerRatingFromRow(p));
}

function BenchRow({
  player, isSelected, onSelect, action, disabled,
}: {
  player: AvailablePlayer;
  isSelected: boolean;
  onSelect: () => void;
  action: { label: string; onClick: () => void } | null;
  disabled: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:bg-zinc-800 transition-colors ${
        isSelected ? "bg-indigo-950/50 ring-1 ring-inset ring-indigo-600" : ""
      }`}
    >
      <span className="text-sm text-zinc-300 min-w-0 truncate">{player.display_name ?? player.username}</span>
      {player.sub_willing && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 border border-emerald-900 rounded px-1.5 py-0.5">
          Sub
        </span>
      )}
      <span className="ml-auto text-xs text-zinc-500 shrink-0">{rv(player).toLocaleString()} RV</span>
      {action && (
        <button
          onClick={(e) => { e.stopPropagation(); action.onClick(); }}
          disabled={disabled}
          className="shrink-0 text-xs text-zinc-400 hover:text-indigo-400 disabled:opacity-40 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function PickRow({
  player, checked, disabled, onToggle,
}: {
  player: AvailablePlayer;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-indigo-950/50 ring-1 ring-inset ring-indigo-600" : "hover:bg-zinc-800"
      }`}
    >
      <span
        className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${
          checked ? "bg-indigo-600 border-indigo-500 text-white" : "border-zinc-600"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <span className="text-sm text-zinc-200 min-w-0 truncate">{player.display_name ?? player.username}</span>
      {player.sub_willing && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 border border-emerald-900 rounded px-1.5 py-0.5">
          Sub
        </span>
      )}
      <span className="ml-auto text-xs text-zinc-500 shrink-0">{rv(player).toLocaleString()} RV</span>
    </button>
  );
}

// The roster has to be exactly team_size: the server rejects anything else, so
// the counter and the disabled rows are only there to say so before the click.
function NewTeamDialog({
  availablePlayers, teamSize, onClose, onCreated,
}: {
  availablePlayers: AvailablePlayer[];
  teamSize: number;
  onClose: () => void;
  onCreated: (message?: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [showOutsiders, setShowOutsiders] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const match = (p: AvailablePlayer) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.username.toLowerCase().includes(q) || (p.display_name ?? "").toLowerCase().includes(q);
  };
  const inEvent = availablePlayers.filter((p) => p.inEvent && match(p));
  const outsiders = availablePlayers.filter((p) => !p.inEvent && match(p));

  const full = selected.length >= teamSize;
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : full ? prev : [...prev, id]));
  const rowFor = (p: AvailablePlayer) => (
    <PickRow
      key={p.id}
      player={p}
      checked={selected.includes(p.id)}
      disabled={isPending || (full && !selected.includes(p.id))}
      onToggle={() => toggle(p.id)}
    />
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createTeam(selected);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onCreated(res?.message);
    });
  }

  // Portaled to the body, same as the profile modal: <main> is isolated, so an
  // overlay rendered inside it sits under the z-20 sidebar and the z-40 mobile
  // tab bar — which would cover the footer holding Create.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-full flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-white">New team</h3>
            <span className={`ml-auto text-xs font-semibold ${full ? "text-emerald-400" : "text-zinc-500"}`}>
              {selected.length} / {teamSize} selected
            </span>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players…"
            autoFocus
            className="mt-3 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-600"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 py-2 border-b border-zinc-800 flex items-center gap-2 bg-zinc-900">
            <span className="text-xs font-semibold text-zinc-400">In this event — no team</span>
            <span className="text-xs text-zinc-600">{inEvent.length}</span>
          </div>
          <div className="divide-y divide-zinc-800">
            {inEvent.length === 0 ? (
              <p className="px-5 py-3 text-xs text-zinc-600">
                {query.trim() ? "No matches." : "Everyone who entered this event is on a team."}
              </p>
            ) : (
              inEvent.map(rowFor)
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowOutsiders((v) => !v)}
            className="w-full px-5 py-2 border-t border-zinc-800 flex items-center gap-2 text-left hover:bg-zinc-800 transition-colors"
          >
            <span className="text-xs font-semibold text-zinc-400">Not in this event</span>
            <span className="text-xs text-zinc-600">{outsiders.length}</span>
            <span className="ml-auto text-xs text-zinc-500">{showOutsiders ? "↑ Hide" : "Show"}</span>
          </button>
          {showOutsiders && (
            <div className="divide-y divide-zinc-800 border-t border-zinc-800">
              {outsiders.length === 0 ? (
                <p className="px-5 py-3 text-xs text-zinc-600">
                  {query.trim() ? "No matches." : "Only approved players appear here — approve a late registration first."}
                </p>
              ) : (
                outsiders.map(rowFor)
              )}
            </div>
          )}
        </div>

        {error && <p className="px-5 py-2 text-xs text-rose-400 border-t border-zinc-800">{error}</p>}

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-2">
          <p className="text-xs text-zinc-600 min-w-0">
            Picking someone who isn&apos;t in the event enters them in it.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !full}
            className="shrink-0 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg"
          >
            {isPending ? "Creating…" : "Create team"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Either a rostered player (tied to a team) or a bench player (no team yet).
type SwapSelection = { kind: "roster"; playerId: string; teamId: string; name: string } | { kind: "bench"; playerId: string; name: string };

function isValidTarget(source: SwapSelection, candidate: SwapSelection): boolean {
  if (source.playerId === candidate.playerId) return false;
  if (source.kind === "bench" && candidate.kind === "bench") return false;
  if (source.kind === "roster" && candidate.kind === "roster" && source.teamId === candidate.teamId) return false;
  return true;
}

export function AdminTeamsManager({ teams, byTeam, teamRv, availablePlayers = [], initialQuery = "", joinMode = "players", teamSize = 3, lateEntriesOpen = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDqTeamId, setConfirmDqTeamId] = useState<string | null>(null);
  const [dqConfirmText, setDqConfirmText] = useState("");
  const [swapSource, setSwapSource] = useState<SwapSelection | null>(null);
  const [swapTarget, setSwapTarget] = useState<SwapSelection | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [benchQuery, setBenchQuery] = useState("");
  const [showOutsiders, setShowOutsiders] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [newTeamNotice, setNewTeamNotice] = useState<string | null>(null);

  const swapEnabled = joinMode !== "teams";

  const benchMatch = (p: AvailablePlayer) => {
    const q = benchQuery.trim().toLowerCase();
    if (!q) return true;
    return p.username.toLowerCase().includes(q) || (p.display_name ?? "").toLowerCase().includes(q);
  };
  const inEventBench = availablePlayers.filter((p) => p.inEvent && benchMatch(p));
  const outsiderBench = availablePlayers.filter((p) => !p.inEvent && benchMatch(p));

  function handleEventMembership(playerId: string, add: boolean) {
    setBenchError(null);
    startTransition(async () => {
      const res = add ? await addPlayerToEvent(playerId) : await removePlayerFromEvent(playerId);
      if (res?.error) setBenchError(res.error);
      else router.refresh();
    });
  }

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
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams or players…"
          className="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => { setNewTeamNotice(null); setNewTeamOpen(true); }}
          title={`Add a team (${teamSize} player${teamSize === 1 ? "" : "s"})`}
          aria-label="Add a team"
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white text-xl leading-none font-semibold transition-colors"
        >
          +
        </button>
      </div>
      {newTeamNotice && <p className="text-xs text-emerald-400">{newTeamNotice}</p>}
      {newTeamOpen && (
        <NewTeamDialog
          availablePlayers={availablePlayers}
          teamSize={teamSize}
          onClose={() => setNewTeamOpen(false)}
          onCreated={(message) => {
            setNewTeamOpen(false);
            setNewTeamNotice(message ?? "Team created.");
            router.refresh();
          }}
        />
      )}
      {teams.length === 0 ? (
        <p className="text-zinc-400 text-sm">No teams yet — the draft hasn&apos;t started. Use ＋ to build one by hand.</p>
      ) : visibleTeams.length === 0 && query.trim() ? (
        <p className="text-zinc-500 text-sm">No teams match &quot;{query}&quot;.</p>
      ) : null}

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
                  <span title="Team rating — carry-weighted, not a roster average">
                    Team RV {(teamRv[team.id] ?? 0).toLocaleString()}
                  </span>
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
                          <PlayerName displayName={player.display_name} username={player.username} discordId={player.discord_id} />
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
            <TeamEditToggleInline team={team} teamSize={teamSize} />
          </div>
        );
      })}
    </div>

      {/* Bench — every approved player with no team, split by whether they're in
          this event. Either side can be swapped in; the split exists because the
          second list is the whole rest of the league and an admin reaching for an
          exception needs to see who actually signed up. */}
      {swapEnabled && availablePlayers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="px-5 py-3 border-b border-zinc-800 space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-300">Available Players</h3>
              <p className="text-xs text-zinc-500">Select a rostered player above, then one of these to swap them in.</p>
            </div>
            <input
              value={benchQuery}
              onChange={(e) => setBenchQuery(e.target.value)}
              placeholder="Search available players…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-600"
            />
          </div>

          {benchError && (
            <p className="px-5 py-2 text-xs text-rose-400 border-b border-zinc-800">{benchError}</p>
          )}

          <div className="px-5 py-2 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400">In this event — no team</span>
            <span className="text-xs text-zinc-600">{inEventBench.length}</span>
          </div>
          <div className="divide-y divide-zinc-800 max-h-72 overflow-y-auto">
            {inEventBench.length === 0 ? (
              <p className="px-5 py-3 text-xs text-zinc-600">
                {benchQuery.trim() ? "No matches." : "Everyone who entered this event is on a team."}
              </p>
            ) : (
              inEventBench.map((p) => (
                <BenchRow
                  key={p.id}
                  player={p}
                  isSelected={swapSource?.playerId === p.id}
                  onSelect={() => handleSelect({ kind: "bench", playerId: p.id, name: p.display_name ?? p.username }, false)}
                  action={lateEntriesOpen ? { label: "Remove", onClick: () => handleEventMembership(p.id, false) } : null}
                  disabled={isPending}
                />
              ))
            )}
          </div>

          <button
            onClick={() => setShowOutsiders((v) => !v)}
            className="w-full px-5 py-2 border-t border-zinc-800 flex items-center gap-2 text-left hover:bg-zinc-800 transition-colors"
          >
            <span className="text-xs font-semibold text-zinc-400">Not in this event</span>
            <span className="text-xs text-zinc-600">{outsiderBench.length}</span>
            <span className="ml-auto text-xs text-zinc-500">{showOutsiders ? "↑ Hide" : "Show"}</span>
          </button>
          {showOutsiders && (
            <div className="divide-y divide-zinc-800 max-h-72 overflow-y-auto border-t border-zinc-800">
              {outsiderBench.length === 0 ? (
                <p className="px-5 py-3 text-xs text-zinc-600">
                  {benchQuery.trim()
                    ? "No matches."
                    : "Only approved players appear here — approve a late registration first."}
                </p>
              ) : (
                outsiderBench.map((p) => (
                  <BenchRow
                    key={p.id}
                    player={p}
                    isSelected={swapSource?.playerId === p.id}
                    onSelect={() => handleSelect({ kind: "bench", playerId: p.id, name: p.display_name ?? p.username }, false)}
                    action={lateEntriesOpen ? { label: "Add to event", onClick: () => handleEventMembership(p.id, true) } : null}
                    disabled={isPending}
                  />
                ))
              )}
            </div>
          )}
          {showOutsiders && (
            <p className="px-5 py-2.5 text-xs text-zinc-600 border-t border-zinc-800">
              Swapping one of these onto a team enters them in the event automatically. Add
              to event enters them without taking anyone off a team, which is also what makes
              them requestable as a sub.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
