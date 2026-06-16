"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeMatchTime, acceptMatchTime, withdrawMatchTime, rejectMatchTime } from "./schedule-actions";

export type SchedulableMatch = {
  id: string;
  opponentName: string;
  opponentId: string | null;
  opponentLogoUrl: string | null;
  roundLabel: string;
  scheduledAt: string | null;
  proposedByTeamId: string | null;
  scheduleAccepted: boolean;
  isHome: boolean;
};

// Deterministic 5-char code derived from a seed, so both teams see the same
// lobby name/password for a match. Excludes ambiguous characters (0/O/1/I/L).
function lobbyCode(seed: string): string {
  const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 5; i++) {
    h = Math.imul(h, 16777619) >>> 0;
    out += CHARS[h % CHARS.length];
  }
  return out;
}

interface Props {
  matches: SchedulableMatch[];
  teamId: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MatchScheduleRow({
  match,
  teamId,
}: {
  match: SchedulableMatch;
  teamId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [dtValue, setDtValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lobbyName = lobbyCode(`${match.id}:name`);
  const lobbyPassword = lobbyCode(`${match.id}:pw`);

  const weProposed = match.proposedByTeamId === teamId;
  const theyProposed = !!match.proposedByTeamId && !weProposed;
  const hasTime = !!match.scheduledAt;
  const confirmed = hasTime && match.scheduleAccepted;
  const awaitingTheirs = hasTime && !match.scheduleAccepted && weProposed;
  const awaitingOurs = hasTime && !match.scheduleAccepted && theyProposed;

  function openForm() {
    setDtValue(match.scheduledAt ? toDatetimeLocalValue(match.scheduledAt) : "");
    setError(null);
    setShowForm(true);
  }

  function handlePropose() {
    if (!dtValue) { setError("Pick a date and time."); return; }
    const dt = new Date(dtValue);
    if (dt.getTime() <= Date.now()) { setError("Must be in the future."); return; }
    setError(null);
    startTransition(async () => {
      const res = await proposeMatchTime(match.id, dt.toISOString());
      if (res.error) { setError(res.error); return; }
      setShowForm(false);
      router.refresh();
    });
  }

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptMatchTime(match.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectMatchTime(match.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleWithdraw() {
    setError(null);
    startTransition(async () => {
      const res = await withdrawMatchTime(match.id);
      if (res.error) { setError(res.error); return; }
      setShowForm(false);
      router.refresh();
    });
  }

  return (
    <div className="px-5 py-4 border-b border-zinc-800 last:border-0 space-y-3">

      {/* Header row: opponent + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {match.opponentLogoUrl ? (
            <img src={match.opponentLogoUrl} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
          ) : (
            <div className="w-8 h-8 rounded shrink-0 bg-zinc-800 border border-zinc-700" />
          )}
          <div>
            <p className="text-sm font-medium text-white">vs {match.opponentName}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">{match.roundLabel}</p>
          </div>
        </div>
        {confirmed && (
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            Confirmed
          </span>
        )}
        {awaitingTheirs && (
          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            Awaiting
          </span>
        )}
        {awaitingOurs && (
          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-400/10 border border-indigo-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            Action needed
          </span>
        )}
      </div>

      {/* Current scheduled time */}
      {hasTime && !showForm && (
        <p className={`text-sm ${confirmed ? "text-emerald-300" : "text-zinc-300"}`}>
          {confirmed ? "✅" : "📅"} {formatDateTime(match.scheduledAt!)}
        </p>
      )}

      {/* Captain actions (non-form state) */}
      {!showForm && (
        <div className="flex items-center gap-3 flex-wrap">
          {!hasTime && (
            <button
              onClick={openForm}
              disabled={isPending}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors disabled:opacity-50"
            >
              + Propose Time
            </button>
          )}

          {awaitingOurs && (
            <>
              <button
                onClick={handleAccept}
                disabled={isPending}
                className="px-3 py-1 bg-emerald-700/40 hover:bg-emerald-600/40 border border-emerald-700/50 text-emerald-300 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isPending ? "Accepting…" : "Accept"}
              </button>
              <button
                onClick={handleReject}
                disabled={isPending}
                className="px-3 py-1 bg-red-800/40 hover:bg-red-700/40 border border-red-700/50 text-red-300 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isPending ? "Rejecting…" : "Reject"}
              </button>
              <button
                onClick={openForm}
                disabled={isPending}
                className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                Propose Different Time
              </button>
            </>
          )}

          {(awaitingTheirs || confirmed) && (
            <button
              onClick={openForm}
              disabled={isPending}
              className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              Change Time
            </button>
          )}

          {hasTime && !confirmed && weProposed && (
            <button
              onClick={handleWithdraw}
              disabled={isPending}
              className="text-xs text-red-500/70 hover:text-red-400 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {/* Propose / change form */}
      {showForm && (
        <div className="space-y-2">
          <input
            type="datetime-local"
            value={dtValue}
            min={minDatetimeLocal()}
            onChange={(e) => setDtValue(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePropose}
              disabled={isPending || !dtValue}
              className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {isPending ? "Saving…" : hasTime ? "Update Time" : "Propose Time"}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null); }}
              disabled={isPending}
              className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            {hasTime && (
              <button
                onClick={handleWithdraw}
                disabled={isPending}
                className="text-xs text-red-500/70 hover:text-red-400 transition-colors ml-auto"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {error && !showForm && <p className="text-xs text-red-400">{error}</p>}

      {/* Private match lobby — name & password (same for both teams). Away creates it. */}
      <div
        className={`border rounded-lg px-3 py-3 space-y-3 ${
          match.isHome
            ? "bg-blue-500/15 border-blue-500/30"
            : "bg-orange-500/15 border-orange-500/30"
        }`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 text-center">Private Match</p>

        <div className="flex justify-center">
          <span
            className={`text-base font-bold px-4 py-1.5 rounded-lg border ${
              match.isHome
                ? "bg-sky-900/40 text-sky-100 border-sky-700/50"
                : "bg-orange-900/40 text-orange-100 border-orange-700/50"
            }`}
          >
            {match.isHome ? "🏠 You're Home" : "✈️ You're Away"}
          </span>
        </div>

        <p className="text-sm font-bold text-zinc-100 text-center">
          {match.isHome
            ? `${match.opponentName} (Away) creates the lobby — join it with the name and password below.`
            : "Your team is Away, so you create the lobby in Rocket League with the name and password below."}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900/60 rounded-md px-2.5 py-2 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Name</p>
            <p className="font-mono text-base font-semibold text-white tracking-widest">{lobbyName}</p>
          </div>
          <div className="bg-zinc-900/60 rounded-md px-2.5 py-2 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Password</p>
            <p className="font-mono text-base font-semibold text-white tracking-widest">{lobbyPassword}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MatchSchedulePanel({ matches, teamId }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Match Schedule</h2>
      </div>
      {matches.map((m) => (
        <MatchScheduleRow key={m.id} match={m} teamId={teamId} />
      ))}
    </div>
  );
}
