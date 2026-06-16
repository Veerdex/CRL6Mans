"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePlayerData } from "./player-actions";
import { kickPlayer, banPlayer, unbanPlayer } from "./player-moderation-actions";
import type { StaffRole } from "@/app/lib/players";
import { PlayerName } from "@/app/dashboard/player-name";

export type CombinedPlayer = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  status: "approved" | "banned";
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  banReason: string | null;
  kickReason: string | null;
  staffRole: StaffRole | null;
};

type ModeAction = "kick" | "ban" | null;

const TIMEOUT_OPTIONS = [
  { label: "1 hour",   ms: 60 * 60 * 1000 },
  { label: "12 hours", ms: 12 * 60 * 60 * 1000 },
  { label: "1 day",    ms: 24 * 60 * 60 * 1000 },
  { label: "3 days",   ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "7 days",   ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "14 days",  ms: 14 * 24 * 60 * 60 * 1000 },
  { label: "28 days",  ms: 28 * 24 * 60 * 60 * 1000 },
];

function canActOn(actorRole: StaffRole | null, targetRole: StaffRole | null): boolean {
  if (actorRole === "ceo") return true;
  if (actorRole === "director") return targetRole !== "director" && targetRole !== "ceo";
  if (actorRole === "moderator") return targetRole === null;
  return false;
}

function PlayerRow({ player, actorRole }: { player: CombinedPlayer; actorRole: StaffRole | null }) {
  const router = useRouter();
  const [editOpen, setEditOpen]     = useState(false);
  const [modeAction, setModeAction] = useState<ModeAction>(null);
  const [reason, setReason]         = useState("");
  const [timeoutMs, setTimeoutMs]   = useState(TIMEOUT_OPTIONS[4].ms); // default 7 days
  const [isPending, startTx]        = useTransition();
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [username, setUsername]     = useState(player.username);
  const [trackerUrl, setTrackerUrl] = useState(player.tracker_url);
  const [peak3v3, setPeak3v3]       = useState(player.peak_3v3);
  const [curr3v3, setCurr3v3]       = useState(player.current_3v3);
  const [peak2v2, setPeak2v2]       = useState(player.peak_2v2);
  const [curr2v2, setCurr2v2]       = useState(player.current_2v2);

  const isBanned = player.status === "banned";
  const peakMmr  = (Number(peak2v2) + Number(curr2v2)) * 0.3 + (Number(peak3v3) + Number(curr3v3)) * 0.2;
  const canModerate = canActOn(actorRole, player.staffRole);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTx(async () => {
      const res = await updatePlayerData(player.id, {
        username, tracker_url: trackerUrl,
        peak_3v3: peak3v3, current_3v3: curr3v3,
        peak_2v2: peak2v2, current_2v2: curr2v2,
      });
      if (res?.error) { setError(res.error); return; }
      setSaved(true);
      setEditOpen(false);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  function handleCancelEdit() {
    setUsername(player.username);
    setTrackerUrl(player.tracker_url);
    setPeak3v3(player.peak_3v3);
    setCurr3v3(player.current_3v3);
    setPeak2v2(player.peak_2v2);
    setCurr2v2(player.current_2v2);
    setEditOpen(false);
    setError(null);
  }

  function handleConfirmMod() {
    setError(null);
    startTx(async () => {
      const res = modeAction === "kick"
        ? await kickPlayer(player.id, reason, timeoutMs)
        : await banPlayer(player.id, reason);
      if (res.error) { setError(res.error); return; }
      setModeAction(null);
      setReason("");
      router.refresh();
    });
  }

  function handleUnban() {
    setError(null);
    startTx(async () => {
      const res = await unbanPlayer(player.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        {player.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`}
            alt="" width={28} height={28} className="rounded-full shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
        )}

        <a
          href={player.tracker_url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm font-medium text-zinc-200 truncate min-w-0 hover:text-indigo-400 transition-colors"
        >
          <PlayerName displayName={player.display_name} username={username} />
        </a>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isBanned ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-red-900/40 border-red-700/50 text-red-300">
              banned
            </span>
          ) : player.kickReason ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-900/30 border-amber-700/40 text-amber-300">
              kicked
            </span>
          ) : null}

          <span className="text-xs text-zinc-500 tabular-nums hidden sm:block">
            {Math.round(peakMmr).toLocaleString()} RV
          </span>

          {saved && <span className="text-xs text-emerald-400">Saved</span>}

          {!isBanned && (
            <button
              onClick={() => { setEditOpen(v => !v); setModeAction(null); setError(null); }}
              disabled={isPending}
              className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
            >
              {editOpen ? "Close" : "Edit"}
            </button>
          )}

          {isBanned ? (
            canModerate && (
              <button
                onClick={handleUnban}
                disabled={isPending}
                className="px-3 py-1 bg-zinc-800 hover:bg-emerald-900/40 border border-zinc-700 hover:border-emerald-700/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Unban
              </button>
            )
          ) : canModerate ? (
            <>
              <button
                onClick={() => { setModeAction("kick"); setReason(""); setEditOpen(false); setError(null); }}
                disabled={isPending || modeAction !== null}
                className="px-3 py-1 bg-zinc-800 hover:bg-amber-900/30 border border-zinc-700 hover:border-amber-700/40 text-amber-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Kick
              </button>
              <button
                onClick={() => { setModeAction("ban"); setReason(""); setEditOpen(false); setError(null); }}
                disabled={isPending || modeAction !== null}
                className="px-3 py-1 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Ban
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Ban/kick reason display */}
      {isBanned && player.banReason && (
        <p className="text-xs text-red-400/80 px-4 pb-2">Reason: {player.banReason}</p>
      )}
      {!isBanned && player.kickReason && (
        <p className="text-xs text-amber-400/80 px-4 pb-2">Last kick: {player.kickReason}</p>
      )}

      {/* Data edit form */}
      {editOpen && (
        <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Username"    value={username}   onChange={setUsername} />
            <Field label="Tracker URL" value={trackerUrl} onChange={setTrackerUrl} />
            <Field label="Peak 3v3"    value={peak3v3}    onChange={setPeak3v3} type="number" />
            <Field label="Current 3v3" value={curr3v3}    onChange={setCurr3v3} type="number" />
            <Field label="Peak 2v2"    value={peak2v2}    onChange={setPeak2v2} type="number" />
            <Field label="Current 2v2" value={curr2v2}    onChange={setCurr2v2} type="number" />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isPending ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={handleCancelEdit}
              disabled={isPending}
              className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}

      {/* Kick/ban confirmation */}
      {modeAction !== null && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={modeAction === "ban" ? "Reason for ban (recommended)" : "Reason for kick (optional)"}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {modeAction === "kick" && (
            <select
              value={timeoutMs}
              onChange={e => setTimeoutMs(Number(e.target.value))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {TIMEOUT_OPTIONS.map(opt => (
                <option key={opt.ms} value={opt.ms}>{opt.label}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirmMod}
              disabled={isPending}
              className={`px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                modeAction === "ban" ? "bg-red-600 hover:bg-red-500" : "bg-amber-700 hover:bg-amber-600"
              }`}
            >
              {isPending ? "…" : `Confirm ${modeAction === "ban" ? "Ban" : "Kick"}`}
            </button>
            <button
              onClick={() => { setModeAction(null); setReason(""); setError(null); }}
              disabled={isPending}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlayerPanel({ players, actorRole }: { players: CombinedPlayer[]; actorRole: StaffRole | null }) {
  const [search, setSearch] = useState("");

  const filtered = players.filter(p =>
    p.username.toLowerCase().includes(search.toLowerCase()) ||
    (p.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const active = filtered.filter(p => p.status !== "banned");
  const banned = filtered.filter(p => p.status === "banned");

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search players…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {active.length === 0 && banned.length === 0 && (
        <p className="text-zinc-500 text-sm">No players found.</p>
      )}

      {active.length > 0 && (
        <div className="space-y-2">
          {active.map(p => <PlayerRow key={p.id} player={p} actorRole={actorRole} />)}
        </div>
      )}

      {banned.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider pt-2">Banned</p>
          {banned.map(p => <PlayerRow key={p.id} player={p} actorRole={actorRole} />)}
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
      />
    </div>
  );
}
