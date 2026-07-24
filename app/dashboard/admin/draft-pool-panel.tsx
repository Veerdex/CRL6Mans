"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removePlayerFromDraft } from "./league-actions";
import { PlayerName } from "@/app/dashboard/player-name";

export type DraftPoolEntry = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
  draft_entered_at: string | null;
};

function rankValue(p: DraftPoolEntry): number {
  return (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2;
}

function DraftPoolRow({ entry }: { entry: DraftPoolEntry }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTx(async () => {
      const res = await removePlayerFromDraft(entry.id);
      if (res.error) { setError(res.error); return; }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 flex-wrap bg-zinc-900 border border-zinc-800 rounded-xl">
      {entry.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://cdn.discordapp.com/avatars/${entry.discord_id}/${entry.avatar}.png`}
          alt="" width={28} height={28} className="rounded-full shrink-0"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
      )}

      <span className="flex-1 text-sm font-medium text-zinc-200 truncate min-w-0">
        <PlayerName displayName={entry.display_name} username={entry.username} />
      </span>

      <span className="text-xs text-zinc-500 tabular-nums shrink-0">
        {Math.round(rankValue(entry)).toLocaleString()} RV
      </span>

      {entry.draft_entered_at && (
        <span className="text-xs text-zinc-500 tabular-nums hidden sm:block shrink-0">
          Entered {new Date(entry.draft_entered_at).toLocaleDateString()}
        </span>
      )}

      {confirming ? (
        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "…" : "Confirm"}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={isPending}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-3 py-1 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  );
}

export function DraftPoolPanel({ entries }: { entries: DraftPoolEntry[] }) {
  const [search, setSearch] = useState("");

  const filtered = entries.filter(e =>
    e.username.toLowerCase().includes(search.toLowerCase()) ||
    (e.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search draft pool…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm">No players in the draft pool.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => <DraftPoolRow key={e.id} entry={e} />)}
        </div>
      )}
    </div>
  );
}
