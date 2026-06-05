"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitSubRequest, cancelSubRequest } from "@/app/dashboard/subs/actions";

export type SubRosterPlayer = {
  id: string;
  username: string;
  peak_2v2: string;
  peak_3v3: string;
};

export type AvailableSub = {
  id: string;
  username: string;
  peak_2v2: string;
  peak_3v3: string;
};

export type MatchOption = {
  id: string;
  label: string;
};

export type SubRequestRow = {
  id: string;
  matchLabel: string | null;
  playerOutName: string;
  playerOutMmr: number;
  subPlayerName: string | null;
  subPlayerMmr: number | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
  createdAt: string;
};

interface Props {
  teamId: string;
  roster: SubRosterPlayer[];
  availableSubs: AvailableSub[];
  upcomingMatches: MatchOption[];
  existingRequests: SubRequestRow[];
  isCaptain: boolean;
}

function peakMmr(p: { peak_2v2: string; peak_3v3: string }) {
  return Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0);
}

const STATUS_STYLES: Record<string, string> = {
  pending:  "text-yellow-400 bg-yellow-400/10",
  approved: "text-emerald-400 bg-emerald-400/10",
  rejected: "text-red-400 bg-red-400/10",
};

export function SubRequestPanel({
  teamId, roster, availableSubs, upcomingMatches, existingRequests, isCaptain,
}: Props) {
  const router = useRouter();
  const [showForm, setShowForm]       = useState(false);
  const [playerOutId, setPlayerOutId] = useState("");
  const [subPlayerId, setSubPlayerId] = useState("");
  const [matchId, setMatchId]         = useState("");
  const [reason, setReason]           = useState("");
  const [formError, setFormError]     = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  const selectedOut    = roster.find(p => p.id === playerOutId);
  const outMmr         = selectedOut ? peakMmr(selectedOut) : Infinity;
  const eligibleSubs   = availableSubs.filter(s => peakMmr(s) <= outMmr);

  function resetForm() {
    setPlayerOutId(""); setSubPlayerId(""); setMatchId(""); setReason("");
    setFormError(null); setShowForm(false);
  }

  function handleSubmit() {
    if (!playerOutId) { setFormError("Select the player being replaced."); return; }
    setFormError(null);
    startTransition(async () => {
      const res = await submitSubRequest(teamId, matchId || null, playerOutId, subPlayerId || null, reason);
      if (res.error) setFormError(res.error);
      else { resetForm(); router.refresh(); }
    });
  }

  function handleCancel(requestId: string) {
    startTransition(async () => {
      const res = await cancelSubRequest(requestId);
      if (!res?.error) router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Sub Requests</h2>
        {isCaptain && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
          >
            + Request Sub
          </button>
        )}
      </div>

      {showForm && (
        <div className="px-5 py-4 border-b border-zinc-800 space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">New Request</p>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
              Player Being Replaced *
            </label>
            <select
              value={playerOutId}
              onChange={e => { setPlayerOutId(e.target.value); setSubPlayerId(""); }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Select player…</option>
              {roster.map(p => (
                <option key={p.id} value={p.id}>
                  {p.username} ({peakMmr(p).toLocaleString()} MMR)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
              Sub Player
              {selectedOut && (
                <span className="ml-1 text-zinc-600 normal-case font-normal">
                  — must be ≤ {outMmr.toLocaleString()} MMR
                </span>
              )}
            </label>
            <select
              value={subPlayerId}
              onChange={e => setSubPlayerId(e.target.value)}
              disabled={!playerOutId}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            >
              <option value="">Leave TBD</option>
              {eligibleSubs.map(s => (
                <option key={s.id} value={s.id}>
                  {s.username} ({peakMmr(s).toLocaleString()} MMR)
                </option>
              ))}
            </select>
            {playerOutId && eligibleSubs.length === 0 && (
              <p className="text-xs text-zinc-500 mt-1">No registered subs within the MMR limit.</p>
            )}
          </div>

          {upcomingMatches.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                Match (optional)
              </label>
              <select
                value={matchId}
                onChange={e => setMatchId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Unspecified</option>
                {upcomingMatches.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
              Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. scheduling conflict"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={isPending || !playerOutId}
              className="px-4 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isPending ? "Submitting…" : "Submit Request"}
            </button>
            <button
              onClick={resetForm}
              disabled={isPending}
              className="px-4 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-zinc-800">
        {existingRequests.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500">No sub requests yet.</p>
        ) : (
          existingRequests.map(req => (
            <div key={req.id} className="px-5 py-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLES[req.status]}`}>
                    {req.status}
                  </span>
                  <span className="text-sm text-zinc-200">
                    {req.playerOutName}
                    <span className="text-zinc-500 mx-1">→</span>
                    {req.subPlayerName ?? <span className="text-zinc-500 italic">TBD</span>}
                  </span>
                </div>
                {req.status === "pending" && isCaptain && (
                  <button
                    onClick={() => handleCancel(req.id)}
                    disabled={isPending}
                    className="text-[10px] text-red-400 hover:text-red-300 transition-colors shrink-0"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {req.matchLabel && (
                <p className="text-xs text-zinc-500">{req.matchLabel}</p>
              )}
              {req.reason && (
                <p className="text-xs text-zinc-500">Reason: {req.reason}</p>
              )}
              {req.adminNote && (
                <p className="text-xs text-amber-400">Admin: {req.adminNote}</p>
              )}

              <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                {req.playerOutMmr > 0 && (
                  <span>Out: {req.playerOutMmr.toLocaleString()} MMR</span>
                )}
                {req.subPlayerMmr !== null && (
                  <span>Sub: {req.subPlayerMmr.toLocaleString()} MMR</span>
                )}
                <span>{new Date(req.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
