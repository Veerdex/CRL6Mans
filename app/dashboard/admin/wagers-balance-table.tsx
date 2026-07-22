"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustPlayerBalance } from "./wagers-actions";

export type BalanceRow = {
  id: string;
  username: string;
  displayName: string | null;
  balance: number;
};

export function WagersBalanceTable({ rows }: { rows: BalanceRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = rows.filter(r => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return r.username.toLowerCase().includes(q) || (r.displayName ?? "").toLowerCase().includes(q);
  });

  function toggle(id: string) {
    setOpenId(openId === id ? null : id);
    setAmount("");
    setReason("");
    setError(null);
  }

  function submit(playerId: string) {
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
    startTransition(async () => {
      const res = await adjustPlayerBalance(playerId, n, reason);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpenId(null);
      setAmount("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search players…"
        className="w-full sm:w-64 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
        {filtered.map(r => (
          <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{r.displayName ?? r.username}</p>
                <p className="text-xs text-zinc-500 truncate">@{r.username}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-mono text-zinc-300">{r.balance.toLocaleString()}</span>
                <button
                  onClick={() => toggle(r.id)}
                  className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Adjust
                </button>
              </div>
            </div>
            {openId === r.id && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="Amount (+/-)"
                  className="w-full sm:w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason (required)"
                  className="w-full flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => submit(r.id)}
                  disabled={isPending}
                  className="px-4 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                >
                  {isPending ? "Applying…" : "Apply"}
                </button>
              </div>
            )}
            {openId === r.id && error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-500 py-2">No players match.</p>
        )}
      </div>
    </div>
  );
}
