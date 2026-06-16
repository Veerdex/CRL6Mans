"use client";

import { useState, useRef } from "react";
import { analyzeReplayFile } from "./actions";
import type { ReplayAnalysis, PlayerMatchInfo } from "./actions";

export function ReplayTester() {
  const [result, setResult]   = useState<ReplayAnalysis | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  function loadFile(file: File) {
    pendingFileRef.current = file;
    setFilename(file.name);
    setResult(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = pendingFileRef.current ?? inputRef.current?.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const fd = new FormData();
    fd.append("replay", file);
    const res = await analyzeReplayFile(fd);

    setLoading(false);
    if (res.error) setError(res.error);
    else if (res.data) setResult(res.data);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  const team0 = result?.players.filter(p => p.replayTeam === 0) ?? [];
  const team1 = result?.players.filter(p => p.replayTeam === 1) ?? [];

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors select-none ${
            dragging
              ? "border-indigo-400 bg-indigo-500/10"
              : "border-zinc-700 hover:border-indigo-500"
          }`}
        >
          {filename ? (
            <p className="text-sm text-white font-medium">{filename}</p>
          ) : dragging ? (
            <p className="text-sm text-indigo-300 font-medium">Drop it!</p>
          ) : (
            <>
              <p className="text-sm text-zinc-400">Drag & drop or click to select a <span className="text-white">.replay</span> file</p>
              <p className="text-xs text-zinc-600 mt-1">Max 5 MB</p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".replay"
          onChange={handleChange}
          className="hidden"
        />
        <button
          type="submit"
          disabled={loading || !filename}
          className="w-full py-2.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {loading ? "Analyzing…" : "Analyze Replay"}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4">
          <p className="text-sm text-red-400 font-medium">Parse error</p>
          <p className="text-sm text-red-300 mt-1">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Bad replay warning */}
          {result.badReplay && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-xl px-5 py-4 space-y-2">
              <p className="text-sm font-semibold text-red-400">Bad replay — unmatched players</p>
              <p className="text-xs text-red-300">
                {result.unmatchedNames.length === 1
                  ? `1 player could not be matched to a registered player:`
                  : `${result.unmatchedNames.length} players could not be matched to a registered player:`}
              </p>
              <div className="space-y-1">
                {result.players
                  .filter(p => p.discordUsername === null)
                  .map((p, i) => (
                    <div key={i} className="text-xs font-mono text-red-200 flex flex-wrap gap-x-2">
                      <span className="text-red-100">&ldquo;{p.replayName}&rdquo;</span>
                      <span className="text-red-400/70">→ normalized: &ldquo;{p.normalizedKey}&rdquo;</span>
                    </div>
                  ))}
              </div>
              <p className="text-[11px] text-red-300/70">
                Compare the normalized key against the registered names below. A match needs the
                replay name to equal a player&rsquo;s tracker name, Discord username, or display name
                (after normalization).
              </p>
            </div>
          )}

          {/* Match summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex flex-wrap gap-x-8 gap-y-2 items-center">
            <div className="flex items-center gap-3">
              <span className="text-blue-400 font-bold text-2xl">{result.team0Score}</span>
              <span className="text-zinc-500 text-lg">–</span>
              <span className="text-orange-400 font-bold text-2xl">{result.team1Score}</span>
            </div>
            {result.mapName && (
              <div className="text-sm">
                <span className="text-zinc-500">Map </span>
                <span className="text-zinc-200">{result.mapName}</span>
              </div>
            )}
            {result.date && (
              <div className="text-sm">
                <span className="text-zinc-500">Date </span>
                <span className="text-zinc-200">{result.date}</span>
              </div>
            )}
            <div className="text-sm">
              <span className="text-zinc-500">Matched </span>
              <span className={result.badReplay ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>
                {result.players.filter(p => p.discordUsername !== null).length}/{result.players.length}
              </span>
            </div>
          </div>

          <TeamTable label="Blue Team (team0)" players={team0} color="blue" />
          <TeamTable label="Orange Team (team1)" players={team1} color="orange" />

          <p className="text-xs text-zinc-600 text-center">
            Demo counts require full network-frame parsing and are not shown here.
          </p>

          <TrackerDirectory entries={result.directory} />

          {result._rawProps && <RawProps data={result._rawProps} />}
        </div>
      )}
    </div>
  );
}

function TrackerDirectory({ entries }: { entries: ReplayAnalysis["directory"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Registered tracker names ({entries.length})
        </span>
        <span className="text-zinc-500 text-xs">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div className="bg-zinc-950 max-h-96 overflow-auto">
          {entries.length === 0 ? (
            <p className="px-4 py-3 text-xs text-zinc-500">No approved players have a tracker URL set.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800 sticky top-0 bg-zinc-950">
                  <th className="text-left px-4 py-2">Discord</th>
                  <th className="text-left px-4 py-2">Resolved tracker name</th>
                  <th className="text-left px-4 py-2">Normalized key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-zinc-300">{e.username}</td>
                    <td className="px-4 py-2 font-mono text-zinc-200">{e.trackerName ?? <span className="text-amber-400/80">— unresolved —</span>}</td>
                    <td className="px-4 py-2 font-mono text-zinc-500">{e.normalizedKey ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function RawProps({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Raw header properties</span>
        <span className="text-zinc-500 text-xs">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <pre className="bg-zinc-950 px-4 py-3 text-xs text-zinc-300 overflow-auto max-h-96 leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function TeamTable({
  label,
  players,
  color,
}: {
  label: string;
  players: PlayerMatchInfo[];
  color: "blue" | "orange";
}) {
  const accentText = color === "blue" ? "text-blue-400" : "text-orange-400";
  const accentBg   = color === "blue" ? "bg-blue-950/40" : "bg-orange-950/40";

  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-zinc-800 ${accentBg}`}>
        <span className={`text-xs font-bold uppercase tracking-wider ${accentText}`}>{label}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800 bg-zinc-900">
            <th className="text-left   px-4 py-2">Tracker name</th>
            <th className="text-left   px-4 py-2">Discord / Team</th>
            <th className="text-right  px-3 py-2">Score</th>
            <th className="text-right  px-3 py-2">Goals</th>
            <th className="text-right  px-3 py-2">Assists</th>
            <th className="text-right  px-3 py-2">Saves</th>
            <th className="text-right  px-3 py-2">Shots</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {players.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-center text-zinc-500 text-xs">
                No players found
              </td>
            </tr>
          ) : (
            players.map((p, i) => (
              <tr key={i} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-2.5 font-medium text-white">{p.replayName}</td>
                <td className="px-4 py-2.5">
                  {p.discordUsername ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-zinc-200 text-xs flex items-center gap-1.5">
                        {p.discordUsername}
                        {p.matchSource && p.matchSource !== "tracker" && (
                          <span className="text-[9px] font-semibold px-1 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-700/40 uppercase">
                            via {p.matchSource}
                          </span>
                        )}
                      </span>
                      {p.teamName && (
                        <span className="text-zinc-500 text-[10px]">{p.teamName}</span>
                      )}
                    </div>
                  ) : (
                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-900/50 text-red-400 border border-red-700/50">
                      Unmatched
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">{p.score}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">{p.goals}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">{p.assists}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">{p.saves}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-200">{p.shots}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
