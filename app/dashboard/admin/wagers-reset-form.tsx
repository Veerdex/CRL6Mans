"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetAllBalancesToStart } from "./wagers-actions";

export function WagersResetForm({ approvedCount }: { approvedCount: number }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }

    startTransition(async () => {
      const res = await resetAllBalancesToStart(reason);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(`Reset ${res.affected} players to 1000.`);
      setConfirming(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-red-900/50 rounded-xl p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Reset Everyone to 1000</p>
        <p className="text-xs text-zinc-500 mt-1">
          Sets every approved player&apos;s Westside Wages to 1000, as if they&apos;d just joined. Overwrites current
          balances — any grants, wins, or manual adjustments already applied are wiped out.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={reason}
          onChange={e => { setReason(e.target.value); setConfirming(false); setResult(null); }}
          placeholder="Reason (required)"
          className="w-full flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        <button
          onClick={handleClick}
          disabled={isPending}
          className={`px-4 py-1.5 text-white text-sm font-medium rounded-lg transition-colors shrink-0 disabled:opacity-50 ${
            confirming ? "bg-red-700 hover:bg-red-600" : "bg-zinc-700 hover:bg-zinc-600"
          }`}
        >
          {isPending ? "Resetting…" : confirming ? `Confirm — reset all ${approvedCount} to 1000` : "Reset to 1000"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <p className="text-xs text-emerald-400">{result}</p>}
    </div>
  );
}
