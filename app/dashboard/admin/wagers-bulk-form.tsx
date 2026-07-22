"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkAdjustAllBalances } from "./wagers-actions";

export function WagersBulkForm({ approvedCount }: { approvedCount: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetConfirm() {
    setConfirming(false);
    setResult(null);
  }

  function handleClick() {
    setError(null);
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0) {
      setError("Enter a non-zero whole number.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }

    startTransition(async () => {
      const res = await bulkAdjustAllBalances(n, reason);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(`Applied to ${res.affected} players.`);
      setConfirming(false);
      setAmount("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-amber-900/50 rounded-xl p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Bulk Adjust — All Approved Players ({approvedCount})</p>
        <p className="text-xs text-zinc-500 mt-1">
          Positive grants Westside Wages to every approved player at once; negative deducts. No individual balance goes below 0.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="number"
          value={amount}
          onChange={e => { setAmount(e.target.value); resetConfirm(); }}
          placeholder="Amount (+/-)"
          className="w-full sm:w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="text"
          value={reason}
          onChange={e => { setReason(e.target.value); resetConfirm(); }}
          placeholder="Reason (required)"
          className="w-full flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={handleClick}
          disabled={isPending}
          className={`px-4 py-1.5 text-white text-sm font-medium rounded-lg transition-colors shrink-0 disabled:opacity-50 ${
            confirming ? "bg-red-700 hover:bg-red-600" : "bg-amber-700 hover:bg-amber-600"
          }`}
        >
          {isPending ? "Applying…" : confirming ? `Confirm — apply to all ${approvedCount}` : "Apply to Everyone"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <p className="text-xs text-emerald-400">{result}</p>}
    </div>
  );
}
