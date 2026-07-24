"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteGameScore, type GameScoreRow } from "@/app/dashboard/game/actions";
import { PlayerName } from "@/app/dashboard/player-name";

function ScoreRow({ entry }: { entry: GameScoreRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTx(async () => {
      const res = await deleteGameScore(entry.discord_id);
      if (res.error) { setError(res.error); return; }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 flex-wrap bg-zinc-900 border border-zinc-800 rounded-xl">
      <span className="flex-1 text-sm font-medium text-zinc-200 truncate min-w-0">
        <PlayerName displayName={entry.display_name} username={entry.username} />
      </span>

      <span className="text-xs text-zinc-400 tabular-nums shrink-0">{entry.score.toLocaleString()} pts</span>

      <span className="text-xs text-zinc-500 tabular-nums hidden sm:block shrink-0">
        {new Date(entry.updated_at).toLocaleDateString()}
      </span>

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

export function GameLeaderboardPanel({ scores }: { scores: GameScoreRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = scores.filter(s =>
    s.username.toLowerCase().includes(search.toLowerCase()) ||
    (s.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search scores…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm">No scores recorded.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => <ScoreRow key={s.discord_id} entry={s} />)}
        </div>
      )}
    </div>
  );
}
