"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kickPlayer, banPlayer, unbanPlayer } from "./player-moderation-actions";
import type { StaffRole } from "@/app/lib/players";

export type ModerationPlayer = {
  id: string;
  discord_id: string;
  username: string;
  status: "approved" | "banned";
  banReason: string | null;
  kickReason: string | null;
  staffRole: StaffRole | null;
};

type Action = "kick" | "ban" | null;

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

function PlayerRow({ player, actorRole }: { player: ModerationPlayer; actorRole: StaffRole | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(TIMEOUT_OPTIONS[4].ms); // default 7 days
  const [error, setError] = useState<string | null>(null);

  const isBanned = player.status === "banned";
  const canModerate = canActOn(actorRole, player.staffRole);

  function cancel() {
    setAction(null);
    setReason("");
    setError(null);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = action === "kick"
        ? await kickPlayer(player.id, reason, timeoutMs)
        : await banPlayer(player.id, reason);
      if (res.error) { setError(res.error); return; }
      cancel();
      router.refresh();
    });
  }

  function handleUnban() {
    setError(null);
    startTransition(async () => {
      const res = await unbanPlayer(player.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium text-white truncate">{player.username}</span>
          {isBanned ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-red-900/40 border-red-700/50 text-red-300 shrink-0">
              banned
            </span>
          ) : player.kickReason ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-900/30 border-amber-700/40 text-amber-300 shrink-0">
              kicked
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isBanned ? (
            canModerate && (
              <button
                onClick={handleUnban}
                disabled={isPending}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-emerald-900/40 border border-zinc-700 hover:border-emerald-700/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Unban
              </button>
            )
          ) : canModerate ? (
            <>
              <button
                onClick={() => { setAction("kick"); setReason(""); setError(null); }}
                disabled={isPending || action !== null}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-amber-900/30 border border-zinc-700 hover:border-amber-700/40 text-amber-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Kick
              </button>
              <button
                onClick={() => { setAction("ban"); setReason(""); setError(null); }}
                disabled={isPending || action !== null}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Ban
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isBanned && player.banReason && (
        <p className="text-xs text-red-400/80 pl-1">Reason: {player.banReason}</p>
      )}
      {!isBanned && player.kickReason && (
        <p className="text-xs text-amber-400/80 pl-1">Last kick reason: {player.kickReason}</p>
      )}

      {action !== null && (
        <div className="pt-1 space-y-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={action === "ban" ? "Reason for ban (recommended)" : "Reason for kick (optional)"}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {action === "kick" && (
            <select
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>{opt.label}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={confirm}
              disabled={isPending}
              className={`px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                action === "ban"
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-amber-700 hover:bg-amber-600"
              }`}
            >
              {isPending ? "…" : `Confirm ${action === "ban" ? "Ban" : "Kick"}`}
            </button>
            <button
              onClick={cancel}
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

export function PlayerModerationPanel({ players, actorRole }: { players: ModerationPlayer[]; actorRole: StaffRole | null }) {
  const [search, setSearch] = useState("");

  const filtered = players.filter((p) =>
    p.username.toLowerCase().includes(search.toLowerCase())
  );

  const banned  = filtered.filter((p) => p.status === "banned");
  const active  = filtered.filter((p) => p.status !== "banned");

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search players…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {active.length === 0 && banned.length === 0 && (
        <p className="text-zinc-500 text-sm">No players found.</p>
      )}

      {active.length > 0 && (
        <div className="space-y-2">
          {active.map((p) => <PlayerRow key={p.id} player={p} actorRole={actorRole} />)}
        </div>
      )}

      {banned.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider pt-2">Banned</p>
          {banned.map((p) => <PlayerRow key={p.id} player={p} actorRole={actorRole} />)}
        </div>
      )}
    </div>
  );
}
