"use client";

import { useState, useTransition } from "react";
import { updatePlayerData } from "./player-actions";
import type { Player } from "@/app/lib/players";

interface Props {
  players: Player[];
}

export function PlayerDataEditor({ players }: Props) {
  const [search, setSearch] = useState("");

  const filtered = players.filter(p =>
    p.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search players…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm">No players found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => <PlayerRow key={p.id} player={p} />)}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ player }: { player: Player }) {
  const [open, setOpen]         = useState(false);
  const [isPending, startTx]    = useTransition();
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [username, setUsername]     = useState(player.username);
  const [trackerUrl, setTrackerUrl] = useState(player.tracker_url);
  const [peak3v3, setPeak3v3]       = useState(player.peak_3v3);
  const [curr3v3, setCurr3v3]       = useState(player.current_3v3);
  const [peak2v2, setPeak2v2]       = useState(player.peak_2v2);
  const [curr2v2, setCurr2v2]       = useState(player.current_2v2);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTx(async () => {
      const res = await updatePlayerData(player.id, {
        username, tracker_url: trackerUrl,
        peak_3v3: peak3v3, current_3v3: curr3v3,
        peak_2v2: peak2v2, current_2v2: curr2v2,
      });
      if (res?.error) {
        setError(res.error);
      } else {
        setSaved(true);
        setOpen(false);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  }

  function handleCancel() {
    setUsername(player.username);
    setTrackerUrl(player.tracker_url);
    setPeak3v3(player.peak_3v3);
    setCurr3v3(player.current_3v3);
    setPeak2v2(player.peak_2v2);
    setCurr2v2(player.current_2v2);
    setOpen(false);
    setError(null);
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Collapsed row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {player.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://cdn.discordapp.com/avatars/${player.discord_id}/${player.avatar}.png`}
            alt="" width={28} height={28} className="rounded-full shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
        )}
        <span className="flex-1 text-sm font-medium text-zinc-200 truncate">{username}</span>
        <span className="text-xs text-zinc-500 shrink-0 tabular-nums hidden sm:block">
          {Math.round((Number(peak2v2) + Number(curr2v2)) * 0.3 + (Number(peak3v3) + Number(curr3v3)) * 0.2).toLocaleString()} RV
        </span>
        {saved && <span className="text-xs text-emerald-400 shrink-0">Saved</span>}
        <button
          onClick={() => setOpen(v => !v)}
          className="shrink-0 text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg transition-colors"
        >
          {open ? "Cancel" : "Edit"}
        </button>
      </div>

      {/* Inline editor */}
      {open && (
        <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Username"    value={username}   onChange={setUsername} />
            <Field label="Tracker URL" value={trackerUrl} onChange={setTrackerUrl} />
            <Field label="Peak 3v3"    value={peak3v3}    onChange={setPeak3v3} type="number" />
            <Field label="Current 3v3" value={curr3v3}    onChange={setCurr3v3} type="number" />
            <Field label="Peak 2v2"    value={peak2v2}    onChange={setPeak2v2} type="number" />
            <Field label="Current 2v2" value={curr2v2}    onChange={setCurr2v2} type="number" />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isPending ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}
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
