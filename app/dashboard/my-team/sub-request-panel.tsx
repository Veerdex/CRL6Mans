"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitSubRequest, cancelSubRequest, escalateSubRequest } from "@/app/dashboard/subs/actions";
import { PlayerName } from "@/app/dashboard/player-name";

export type SubRosterPlayer = {
  id: string;
  username: string;
  display_name: string | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
};

export type AvailableSub = {
  id: string;
  username: string;
  display_name: string | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
};

export type SubRequestRow = {
  id: string;
  matchLabel: string | null;
  opponentName: string | null;
  playerOutName: string;
  playerOutDisplay: string | null;
  playerOutMmr: number;
  subCandidates: { username: string; displayName: string | null; mmr: number }[];
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "escalated";
  adminNote: string | null;
  createdAt: string;
};

interface Props {
  teamId: string;
  roster: SubRosterPlayer[];
  availableSubs: AvailableSub[];
  existingRequests: SubRequestRow[];
}

function peakMmr(p: { peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }) {
  return (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2;
}

const STATUS_META: Record<SubRequestRow["status"], { label: string; cls: string }> = {
  pending:   { label: "Awaiting opponent", cls: "text-yellow-400 bg-yellow-400/10" },
  approved:  { label: "Approved",          cls: "text-emerald-400 bg-emerald-400/10" },
  rejected:  { label: "Rejected",          cls: "text-red-400 bg-red-400/10" },
  escalated: { label: "Reported to staff", cls: "text-indigo-300 bg-indigo-400/10" },
};

export function SubRequestPanel({ teamId, roster, availableSubs, existingRequests }: Props) {
  const router = useRouter();
  const [showForm, setShowForm]       = useState(false);
  const [playerOutId, setPlayerOutId] = useState("");
  const [subPlayerId, setSubPlayerId] = useState("");
  const [reason, setReason]           = useState("");
  const [formError, setFormError]     = useState<string | null>(null);
  const [rowError, setRowError]       = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  // One active request per team — block the form while one exists.
  const hasActive = existingRequests.length > 0;

  const selectedOut  = roster.find(p => p.id === playerOutId);
  const outMmr       = selectedOut ? peakMmr(selectedOut) : Infinity;
  // Sub eligibility: if player out is below 1400 rating, subs can go up to +100 of that rating.
  const mmrLimit     = outMmr < 1400 ? outMmr + 100 : outMmr;
  const eligibleSubs = availableSubs.filter(s => peakMmr(s) <= mmrLimit);

  function resetForm() {
    setPlayerOutId(""); setSubPlayerId(""); setReason("");
    setFormError(null); setShowForm(false);
  }

  function handleSubmit() {
    if (!playerOutId) { setFormError("Select the player being replaced."); return; }
    if (!subPlayerId) { setFormError("Select a substitute."); return; }
    setFormError(null);
    startTransition(async () => {
      const res = await submitSubRequest(teamId, playerOutId, subPlayerId, reason);
      if (res.error) setFormError(res.error);
      else { resetForm(); router.refresh(); }
    });
  }

  function handleCancel(requestId: string, thenOpenForm = false) {
    setRowError(null);
    startTransition(async () => {
      const res = await cancelSubRequest(requestId);
      if (res?.error) { setRowError(res.error); return; }
      if (thenOpenForm) setShowForm(true);
      router.refresh();
    });
  }

  function handleEscalate(requestId: string) {
    setRowError(null);
    startTransition(async () => {
      const res = await escalateSubRequest(requestId);
      if (res?.error) setRowError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Sub Requests</h2>
        {!showForm && !hasActive && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
          >
            + Request Sub
          </button>
        )}
      </div>

      {showForm && !hasActive && (
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
                  {p.display_name ?? p.username} ({Math.round(peakMmr(p)).toLocaleString()} RV)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
              Substitute *
              {selectedOut && (
                <span className="ml-1 text-zinc-600 normal-case font-normal">
                  {outMmr < 1400
                    ? `— max ${Math.round(mmrLimit).toLocaleString()} RV (${Math.round(outMmr).toLocaleString()} + 100)`
                    : `— must be ≤ ${Math.round(mmrLimit).toLocaleString()} RV`}
                </span>
              )}
            </label>
            {!playerOutId ? (
              <p className="text-xs text-zinc-600 italic">Select the replaced player first.</p>
            ) : eligibleSubs.length === 0 ? (
              <p className="text-xs text-zinc-500">No players with substitute availability within the RV limit.</p>
            ) : (
              <select
                value={subPlayerId}
                onChange={e => setSubPlayerId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select substitute…</option>
                {eligibleSubs.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.display_name ?? s.username} ({Math.round(peakMmr(s)).toLocaleString()} RV)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Reason</label>
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
              disabled={isPending || !playerOutId || !subPlayerId}
              className="px-4 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isPending ? "Submitting…" : "Submit Request"}
            </button>
            <button onClick={resetForm} disabled={isPending} className="px-4 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-zinc-800">
        {existingRequests.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500">No sub requests yet.</p>
        ) : (
          existingRequests.map(req => {
            const meta = STATUS_META[req.status];
            const sub = req.subCandidates[0] ?? null;
            return (
              <div key={req.id} className="px-5 py-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.cls}`}>
                    {meta.label}
                  </span>
                  <span className="text-sm text-zinc-200">
                    <PlayerName displayName={req.playerOutDisplay} username={req.playerOutName} />
                    <span className="text-zinc-500 mx-1">→</span>
                    {sub
                      ? <PlayerName displayName={sub.displayName} username={sub.username} />
                      : <span className="text-zinc-500 italic">TBD</span>}
                  </span>
                </div>

                {req.matchLabel && <p className="text-xs text-zinc-500">{req.matchLabel}</p>}
                {req.reason && <p className="text-xs text-zinc-500">Reason: {req.reason}</p>}
                {req.adminNote && <p className="text-xs text-amber-400">Staff: {req.adminNote}</p>}

                {req.status === "pending" && (
                  <p className="text-xs text-zinc-500">Waiting for {req.opponentName ?? "the opposing team"} to accept or reject.</p>
                )}
                {req.status === "rejected" && (
                  <p className="text-xs text-red-400">{req.opponentName ?? "The opposing team"} rejected this sub request.</p>
                )}
                {req.status === "escalated" && (
                  <p className="text-xs text-indigo-300">Reported to staff — awaiting a decision.</p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 flex-wrap pt-0.5">
                  {req.status === "rejected" && (
                    <>
                      <button
                        onClick={() => handleEscalate(req.id)}
                        disabled={isPending}
                        className="px-3 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        Report to admin
                      </button>
                      <button
                        onClick={() => handleCancel(req.id, true)}
                        disabled={isPending}
                        className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-xs font-medium rounded-lg transition-colors"
                      >
                        Request a different sub
                      </button>
                    </>
                  )}
                  {(req.status === "pending" || req.status === "approved" || req.status === "rejected" || req.status === "escalated") && (
                    <button
                      onClick={() => handleCancel(req.id)}
                      disabled={isPending}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Cancel request
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                  {req.playerOutMmr > 0 && <span>Out: {req.playerOutMmr.toLocaleString()} RV</span>}
                  {sub && <span>{sub.displayName ?? sub.username}: {sub.mmr.toLocaleString()} RV</span>}
                  <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })
        )}
        {rowError && <p className="px-5 py-2 text-xs text-red-400">{rowError}</p>}
      </div>
    </div>
  );
}
