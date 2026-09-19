"use client";

import { useEffect, useState } from "react";

export type CronHealthRow = {
  key: string;
  label: string;
  path: string;
  purpose: string;
  lastRunAt: string | null;
};

const GREEN_MS = 3 * 60 * 1000;
const AMBER_MS = 15 * 60 * 1000;

function ageLabel(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}

// Ticks client-side rather than rendering an age on the server: the admin page is
// a long-lived client tree that survives dozens of router.refresh() calls, so a
// server-computed "40s ago" can be arbitrarily stale by the time it's read.
export function CronHealthRows({ rows }: { rows: CronHealthRow[] }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const ts = r.lastRunAt ? new Date(r.lastRunAt).getTime() : null;
        // Null until the first client tick, so SSR and hydration agree.
        const age = ts !== null && now !== null ? now - ts : null;
        const state =
          ts === null ? "never" : age === null ? "pending" : age < GREEN_MS ? "ok" : age < AMBER_MS ? "late" : "down";

        const dot =
          state === "ok"
            ? "bg-emerald-500"
            : state === "late"
              ? "bg-amber-500"
              : state === "down"
                ? "bg-red-500"
                : state === "never"
                  ? "bg-zinc-600"
                  : "bg-zinc-700";

        const text =
          state === "never"
            ? "No heartbeat recorded"
            : state === "pending"
              ? "—"
              : ageLabel(age!);

        const textClass =
          state === "ok"
            ? "text-emerald-400"
            : state === "late"
              ? "text-amber-400"
              : state === "down"
                ? "text-red-400"
                : "text-zinc-500";

        return (
          <div
            key={r.key}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                <span className="text-white font-semibold">{r.label}</span>
              </div>
              <p className="text-xs text-zinc-500 mt-1">{r.purpose}</p>
              <p className="text-xs text-zinc-600 font-mono mt-1 truncate">{r.path}</p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Last ping</div>
              <div className={`text-lg font-bold mt-1 ${textClass}`}>{text}</div>
              {r.lastRunAt && (
                <div className="text-xs text-zinc-600 mt-0.5">
                  {new Date(r.lastRunAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
