"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptSubRequest, rejectSubRequestByOpponent } from "@/app/dashboard/subs/actions";
import { PlayerName } from "@/app/dashboard/player-name";

export type IncomingSubRequest = {
  id: string;
  requestingTeamName: string;
  playerOutName: string;
  playerOutDisplay: string | null;
  playerOutDiscordId: string | null;
  playerOutMmr: number;
  subName: string | null;
  subDisplay: string | null;
  subDiscordId: string | null;
  subMmr: number | null;
  reason: string | null;
  createdAt: string;
};

export function OpposingSubRequestPanel({ requests }: { requests: IncomingSubRequest[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "accept" | "reject" } | null>(null);

  if (requests.length === 0) return null;

  function run(id: string, action: "accept" | "reject") {
    setError(null);
    startTransition(async () => {
      const res = action === "accept"
        ? await acceptSubRequest(id)
        : await rejectSubRequestByOpponent(id);
      setConfirm(null);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-amber-700/40 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-amber-300">Opponent Sub Requests</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Your upcoming opponent wants to use a substitute. Accept or reject it.</p>
      </div>

      <div className="divide-y divide-zinc-800">
        {requests.map((req) => (
          <div key={req.id} className="px-5 py-3 space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="font-semibold text-white">{req.requestingTeamName}</span> wants to sub{" "}
              <PlayerName displayName={req.playerOutDisplay} username={req.playerOutName} discordId={req.playerOutDiscordId} />
              <span className="text-zinc-500 mx-1">→</span>
              {req.subName
                ? <PlayerName displayName={req.subDisplay} username={req.subName} discordId={req.subDiscordId} />
                : <span className="text-zinc-500 italic">TBD</span>}
            </p>

            <div className="flex items-center gap-3 text-[10px] text-zinc-600">
              {req.playerOutMmr > 0 && <span>Out: {req.playerOutMmr.toLocaleString()} RV</span>}
              {req.subMmr !== null && <span>Sub: {req.subMmr.toLocaleString()} RV</span>}
              <span>{new Date(req.createdAt).toLocaleDateString()}</span>
            </div>

            {req.reason && <p className="text-xs text-zinc-500">Reason: {req.reason}</p>}

            <div className="flex items-center gap-3 pt-0.5">
              <button
                onClick={() => setConfirm({ id: req.id, action: "accept" })}
                disabled={isPending}
                className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() => setConfirm({ id: req.id, action: "reject" })}
                disabled={isPending}
                className="px-3 py-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
        {error && <p className="px-5 py-2 text-xs text-red-400">{error}</p>}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !isPending && setConfirm(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-base font-semibold ${confirm.action === "accept" ? "text-emerald-300" : "text-red-300"}`}>
              {confirm.action === "accept" ? "Accept this substitution?" : "Reject this substitution?"}
            </h3>
            <p className="text-sm text-zinc-300">
              {confirm.action === "accept"
                ? "Accepting approves the opponent's substitute for this match. Are you sure?"
                : "Rejecting denies the opponent's substitute. They can report it to staff. Are you sure?"}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => run(confirm.id, confirm.action)}
                disabled={isPending}
                className={`flex-1 px-4 py-2 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors ${
                  confirm.action === "accept" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-red-800 hover:bg-red-700"
                }`}
              >
                {isPending ? "Working…" : confirm.action === "accept" ? "Yes, accept" : "Yes, reject"}
              </button>
              <button
                onClick={() => setConfirm(null)}
                disabled={isPending}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
