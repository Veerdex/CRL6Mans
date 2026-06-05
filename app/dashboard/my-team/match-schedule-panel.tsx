"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeMatchTime, acceptMatchTime, withdrawMatchTime } from "./schedule-actions";

export type SchedulableMatch = {
  id: string;
  opponentName: string;
  opponentId: string | null;
  roundLabel: string;
  scheduledAt: string | null;
  proposedByTeamId: string | null;
  scheduleAccepted: boolean;
};

interface Props {
  matches: SchedulableMatch[];
  teamId: string;
  isCaptain: boolean;
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
  isCaptain,
}: {
  match: SchedulableMatch;
  teamId: string;
  isCaptain: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [dtValue, setDtValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        <div>
          <p className="text-sm font-medium text-white">vs {match.opponentName}</p>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">{match.roundLabel}</p>
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
      {isCaptain && !showForm && (
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
    </div>
  );
}

export function MatchSchedulePanel({ matches, teamId, isCaptain }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Match Schedule</h2>
      </div>
      {matches.map((m) => (
        <MatchScheduleRow key={m.id} match={m} teamId={teamId} isCaptain={isCaptain} />
      ))}
    </div>
  );
}
