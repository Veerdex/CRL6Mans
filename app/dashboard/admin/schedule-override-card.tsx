"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveScheduleOverride, rejectScheduleOverride } from "./schedule-override-actions";
import { LocalTime } from "../local-time";

export type ScheduleOverrideCardData = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  roundLabel: string;
  requestedAt: string;
  windowNote: string | null;
};

export function ScheduleOverrideCard({ data }: { data: ScheduleOverrideCardData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (id: string) => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn(data.matchId);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          {data.homeTeam} <span className="text-zinc-500 font-normal">vs</span> {data.awayTeam}
        </p>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{data.roundLabel}</span>
      </div>

      <p className="text-sm text-purple-300">
        🕓 Requested time: <LocalTime iso={data.requestedAt} />
      </p>
      {data.windowNote && (
        <p className="text-[11px] text-zinc-500">Outside window — {data.windowNote}</p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => run(approveScheduleOverride)}
          disabled={isPending}
          className="px-3 py-1.5 bg-emerald-700/40 hover:bg-emerald-600/40 border border-emerald-700/50 text-emerald-300 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {isPending ? "…" : "Approve"}
        </button>
        <button
          onClick={() => run(rejectScheduleOverride)}
          disabled={isPending}
          className="px-3 py-1.5 bg-red-800/40 hover:bg-red-700/40 border border-red-700/50 text-red-300 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {isPending ? "…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
