"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kickPlayer, banPlayer, unbanPlayer, unkickPlayer } from "./player-moderation-actions";
import type { StaffRole } from "@/app/lib/players";
import { PlayerName } from "@/app/dashboard/player-name";

export type GuestAccount = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  status: "unregistered" | "pending" | "rejected" | "banned";
  banReason: string | null;
  kickReason: string | null;
  kickedUntil: string | null;
  isKicked: boolean;
  staffRole: StaffRole | null;
  createdAt: string;
};

const STATUS_STYLES: Record<GuestAccount["status"], string> = {
  unregistered: "bg-zinc-800 border-zinc-700 text-zinc-400",
  pending:      "bg-indigo-900/30 border-indigo-700/40 text-indigo-300",
  rejected:     "bg-orange-900/30 border-orange-700/40 text-orange-300",
  banned:       "bg-red-900/40 border-red-700/50 text-red-300",
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

function GuestRow({ account, actorRole }: { account: GuestAccount; actorRole: StaffRole | null }) {
  const router = useRouter();
  const [modeAction, setModeAction] = useState<ModeAction>(null);
  const [reason, setReason]         = useState("");
  const [timeoutMs, setTimeoutMs]   = useState(TIMEOUT_OPTIONS[4].ms); // default 7 days
  const [isPending, startTx]        = useTransition();
  const [error, setError]           = useState<string | null>(null);

  const isBanned = account.status === "banned";
  const canModerate = canActOn(actorRole, account.staffRole);

  function handleConfirmMod() {
    setError(null);
    startTx(async () => {
      const res = modeAction === "kick"
        ? await kickPlayer(account.id, reason, timeoutMs)
        : await banPlayer(account.id, reason);
      if (res.error) { setError(res.error); return; }
      setModeAction(null);
      setReason("");
      router.refresh();
    });
  }

  function handleUnban() {
    setError(null);
    startTx(async () => {
      const res = await unbanPlayer(account.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleUnkick() {
    setError(null);
    startTx(async () => {
      const res = await unkickPlayer(account.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        {account.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://cdn.discordapp.com/avatars/${account.discord_id}/${account.avatar}.png`}
            alt="" width={28} height={28} className="rounded-full shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
        )}

        <span className="flex-1 text-sm font-medium text-zinc-200 truncate min-w-0">
          <PlayerName displayName={account.display_name} username={account.username} />
        </span>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_STYLES[account.status]}`}>
            {account.status}
          </span>
          {!isBanned && account.isKicked && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-900/30 border-amber-700/40 text-amber-300">
              kicked
            </span>
          )}

          <span className="text-xs text-zinc-500 tabular-nums hidden sm:block">
            Joined {new Date(account.createdAt).toLocaleDateString()}
          </span>

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
              {account.isKicked && (
                <button
                  onClick={handleUnkick}
                  disabled={isPending}
                  className="px-3 py-1 bg-zinc-800 hover:bg-emerald-900/40 border border-zinc-700 hover:border-emerald-700/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  Lift Kick
                </button>
              )}
              <button
                onClick={() => { setModeAction("kick"); setReason(""); setError(null); }}
                disabled={isPending || modeAction !== null}
                className="px-3 py-1 bg-zinc-800 hover:bg-amber-900/30 border border-zinc-700 hover:border-amber-700/40 text-amber-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Kick
              </button>
              <button
                onClick={() => { setModeAction("ban"); setReason(""); setError(null); }}
                disabled={isPending || modeAction !== null}
                className="px-3 py-1 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Ban
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isBanned && account.banReason && (
        <p className="text-xs text-red-400/80 px-4 pb-2">Reason: {account.banReason}</p>
      )}
      {!isBanned && account.kickReason && (
        <p className="text-xs text-amber-400/80 px-4 pb-2">
          {account.isKicked ? "Kicked" : "Last kick"}: {account.kickReason}
          {account.isKicked && account.kickedUntil && ` (until ${new Date(account.kickedUntil).toLocaleString()})`}
        </p>
      )}

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

type StatusFilter = "all" | "unregistered" | "pending" | "rejected" | "kicked" | "banned";

export function GuestAccountPanel({ accounts, actorRole }: { accounts: GuestAccount[]; actorRole: StaffRole | null }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const searched = accounts.filter(a =>
    a.username.toLowerCase().includes(search.toLowerCase()) ||
    (a.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const counts = {
    unregistered: accounts.filter(a => a.status === "unregistered").length,
    pending:      accounts.filter(a => a.status === "pending").length,
    rejected:     accounts.filter(a => a.status === "rejected").length,
    kicked:       accounts.filter(a => a.status !== "banned" && a.isKicked).length,
    banned:       accounts.filter(a => a.status === "banned").length,
  };

  const FILTER_OPTIONS: { value: StatusFilter; label: string; count: number }[] = [
    { value: "all",          label: "All",          count: accounts.length },
    { value: "unregistered", label: "Unregistered", count: counts.unregistered },
    { value: "pending",      label: "Pending",      count: counts.pending },
    { value: "rejected",     label: "Rejected",     count: counts.rejected },
    { value: "kicked",       label: "Kicked",       count: counts.kicked },
    { value: "banned",       label: "Banned",       count: counts.banned },
  ];

  const filtered = searched.filter(a => {
    if (statusFilter === "all") return true;
    if (statusFilter === "kicked") return a.status !== "banned" && a.isKicked;
    return a.status === statusFilter;
  });

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search accounts…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
              statusFilter === opt.value
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
            }`}
          >
            {opt.label} ({opt.count})
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-zinc-500 text-sm">No accounts found.</p>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(a => <GuestRow key={a.id} account={a} actorRole={actorRole} />)}
        </div>
      )}
    </div>
  );
}
