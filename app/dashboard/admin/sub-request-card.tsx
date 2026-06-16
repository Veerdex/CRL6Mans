"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminApproveSubRequest, cancelSubRequest } from "@/app/dashboard/subs/actions";
import { PlayerName } from "@/app/dashboard/player-name";

export type SubRequestCardData = {
  id: string;
  teamName: string;
  playerOutName: string;
  playerOutDisplay: string | null;
  playerOutMmr: number;
  subCandidates: { username: string; displayName: string | null; mmr: number }[];
  reason: string | null;
  adminNote: string | null;
  requestedByUsername: string | null;
  requestedByDisplay: string | null;
  createdAt: string;
};

export function SubRequestCard({ request }: { request: SubRequestCardData }) {
  const router = useRouter();
  const [note, setNote]               = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  const overMmr = request.subCandidates.some(c => c.mmr > request.playerOutMmr);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await adminApproveSubRequest(request.id, note || undefined);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await cancelSubRequest(request.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-white">{request.teamName}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {request.requestedByUsername ? (
              <>
                Requested by{" "}
                <PlayerName displayName={request.requestedByDisplay} username={request.requestedByUsername} />
                {" · "}
              </>
            ) : ""}
            {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="bg-zinc-800 rounded-lg px-4 py-3 space-y-2">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <p className="text-[10px] text-zinc-500 mb-0.5">Player Out</p>
            <p className="text-sm font-medium text-zinc-200">
              <PlayerName displayName={request.playerOutDisplay} username={request.playerOutName} />
            </p>
            <p className="text-xs text-zinc-500">{request.playerOutMmr.toLocaleString()} RV</p>
          </div>
          <span className="text-zinc-600 text-xl">→</span>
          <div>
            <p className="text-[10px] text-zinc-500 mb-0.5">Sub Candidates</p>
            {request.subCandidates.length > 0 ? (
              <div className="space-y-0.5">
                {request.subCandidates.map((c, i) => {
                  const mmrOk = c.mmr <= request.playerOutMmr;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${mmrOk ? "text-zinc-200" : "text-red-400"}`}>
                        <PlayerName displayName={c.displayName} username={c.username} />
                      </p>
                      <p className={`text-xs ${mmrOk ? "text-zinc-500" : "text-red-400 font-semibold"}`}>
                        {c.mmr.toLocaleString()} RV{!mmrOk && " — OVER LIMIT"}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 italic">TBD</p>
            )}
          </div>
        </div>
        {overMmr && (
          <p className="text-xs text-red-400 font-medium">
            ⚠️ One or more candidates exceed the RV limit
          </p>
        )}
      </div>

      {request.reason && (
        <p className="text-sm text-zinc-400">
          <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mr-2">Reason</span>
          {request.reason}
        </p>
      )}

      <div>
        <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
          Admin Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason for decision…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleApprove}
          disabled={isPending}
          className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Approve"}
        </button>
        <button
          onClick={handleReject}
          disabled={isPending}
          className="px-4 py-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Decline
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
