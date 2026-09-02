"use client";

import { useState, useTransition } from "react";
import { approvePlayerWithEdits, rejectPlayer } from "./player-actions";
import type { Player } from "@/app/lib/players";

interface Props {
  player: Player;
}

const COOLDOWN_OPTIONS: { value: "none" | "5m" | "1d" | "forever"; label: string }[] = [
  { value: "none", label: "No cooldown" },
  { value: "5m", label: "5 minutes" },
  { value: "1d", label: "1 day" },
  { value: "forever", label: "Forever" },
];

export function RegistrationCard({ player }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername]     = useState(player.username);
  const [trackerUrl, setTrackerUrl] = useState(player.tracker_url);
  const [peak3v3, setPeak3v3]       = useState(player.peak_3v3);
  const [curr3v3, setCurr3v3]       = useState(player.current_3v3);
  const [peak2v2, setPeak2v2]       = useState(player.peak_2v2);
  const [curr2v2, setCurr2v2]       = useState(player.current_2v2);
  const [note, setNote]             = useState("");
  const [cooldown, setCooldown]     = useState<"none" | "5m" | "1d" | "forever">("none");

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approvePlayerWithEdits(player.id, {
        username, tracker_url: trackerUrl,
        peak_3v3: peak3v3, current_3v3: curr3v3,
        peak_2v2: peak2v2, current_2v2: curr2v2,
      });
      if (res?.error) setError(res.error);
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectPlayer(player.id, note, cooldown === "none" ? undefined : cooldown);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {player.avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`}
            alt="" width={36} height={36} className="rounded-full shrink-0"
          />
        )}
        <div>
          <p className="font-semibold text-white">{player.username}</p>
          <p className="text-xs text-zinc-500">
            Submitted {new Date(player.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Username" value={username} onChange={setUsername} />
        <Field label="Tracker URL" value={trackerUrl} onChange={setTrackerUrl} />
        <Field label="All Time Peak 2v2" value={peak2v2} onChange={setPeak2v2} type="number" />
        <Field label="Season Peak 2v2"   value={curr2v2} onChange={setCurr2v2} type="number" />
        <Field label="All Time Peak 3v3" value={peak3v3} onChange={setPeak3v3} type="number" />
        <Field label="Season Peak 3v3"   value={curr3v3} onChange={setCurr3v3} type="number" />
      </div>

      {/* Links */}
      <div className="flex flex-col gap-1">
        <a href={player.college_image_url} target="_blank" rel="noopener noreferrer"
          className="text-sm text-indigo-400 hover:underline">
          View college enrollment proof →
        </a>
        <a href={trackerUrl || player.tracker_url} target="_blank" rel="noopener noreferrer"
          className="text-sm text-indigo-400 hover:underline">
          View tracker profile →
        </a>
      </div>

      {/* Rejection fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Rejection Cooldown
          </label>
          <select
            value={cooldown}
            onChange={e => setCooldown(e.target.value as typeof cooldown)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {COOLDOWN_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {cooldown !== "none" && (
            <p className="text-[10px] text-amber-400 mt-1">
              Rejecting will block re-registration ({cooldown === "forever" ? "no auto-expiry" : `eligible again in ${cooldown === "5m" ? "5 minutes" : "1 day"}`}).
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
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

function Field({
  label, value, onChange, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
      />
    </div>
  );
}
