"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePlayerEditRequest, rejectPlayerEditRequest } from "./player-edit-actions";

export type PlayerEditRequestCardData = {
  id: string;
  username: string;
  // requested (new) values
  trackerUrl: string;
  peak3v3: string;
  current3v3: string;
  peak2v2: string;
  current2v2: string;
  // current live values
  liveTrackerUrl: string;
  livePeak3v3: string;
  liveCurrent3v3: string;
  livePeak2v2: string;
  liveCurrent2v2: string;
  createdAt: string;
};

function DiffRow({
  label,
  from,
  to,
  isLink = false,
}: {
  label: string;
  from: string;
  to: string;
  isLink?: boolean;
}) {
  const changed = from !== to;
  const cell = (val: string, highlight: boolean) =>
    val ? (
      isLink ? (
        <a href={val} target="_blank" rel="noopener noreferrer"
          className={`underline underline-offset-2 hover:opacity-80 break-all ${highlight ? "text-emerald-400" : "text-indigo-400"}`}>
          {val}
        </a>
      ) : (
        <span>{val}</span>
      )
    ) : (
      <span className="italic text-zinc-600">—</span>
    );

  return (
    <tr className={changed ? "text-white" : "text-zinc-500"}>
      <td className="py-1 pr-4 text-[11px] font-medium text-zinc-500 whitespace-nowrap">{label}</td>
      <td className="py-1 pr-4 text-sm font-mono">{cell(from, false)}</td>
      <td className="py-1 pr-2 text-zinc-600 text-xs">→</td>
      <td className={`py-1 text-sm font-mono ${changed ? "font-semibold" : ""}`}>
        {cell(to, changed)}
      </td>
    </tr>
  );
}

export function PlayerEditRequestCard({ request }: { request: PlayerEditRequestCardData }) {
  const router = useRouter();
  const [note, setNote]              = useState("");
  const [error, setError]            = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approvePlayerEditRequest(request.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectPlayerEditRequest(request.id, note);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-white">{request.username}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Submitted {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {request.liveTrackerUrl && (
            <a href={request.liveTrackerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-zinc-400 hover:text-zinc-300 underline underline-offset-2 transition-colors">
              Current Tracker ↗
            </a>
          )}
          {request.trackerUrl && (
            <a href={request.trackerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">
              Requested Tracker ↗
            </a>
          )}
        </div>
      </div>

      <div className="bg-zinc-800 rounded-lg px-4 py-3 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-semibold text-zinc-600 uppercase tracking-wider pb-1 pr-4">Field</th>
              <th className="text-left text-[10px] font-semibold text-zinc-600 uppercase tracking-wider pb-1 pr-4">Current</th>
              <th />
              <th className="text-left text-[10px] font-semibold text-zinc-600 uppercase tracking-wider pb-1">Requested</th>
            </tr>
          </thead>
          <tbody>
            <DiffRow label="Tracker URL" from={request.liveTrackerUrl} to={request.trackerUrl} isLink />
            <DiffRow label="Peak 3v3"    from={request.livePeak3v3}    to={request.peak3v3} />
            <DiffRow label="Current 3v3" from={request.liveCurrent3v3} to={request.current3v3} />
            <DiffRow label="Peak 2v2"    from={request.livePeak2v2}    to={request.peak2v2} />
            <DiffRow label="Current 2v2" from={request.liveCurrent2v2} to={request.current2v2} />
          </tbody>
        </table>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
          Admin Note (optional — shown if rejected)
        </label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason for rejection…"
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
          Reject
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
