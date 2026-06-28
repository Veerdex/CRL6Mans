"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { reportMatchResult, dqTeamFromMatch, adminAnalyzeGameReplay, type AnalyzedGameStat, type SubmittedGame } from "./match-actions";

export type PlayerOption = { id: string; label: string };

type MatchData = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  stage: string;
  round: number;
  matchNumber: number;
  bestOf: number;
  scheduledAt: string | null;
  scheduleAccepted: boolean;
  pendingHomeScore: number | null;
  pendingAwayScore: number | null;
  scoreConfirmed: boolean;
  players: PlayerOption[]; // eligible players for this match (both rosters + subs)
};

const STAGE_ORDER: Record<string, number> = {
  group_1: 0, group_2: 1, group_3: 2, group_4: 3, group_5: 4,
  group_6: 5, group_7: 6, group_8: 7,
  se_qualifier: 10,
  de_qualifier_winners: 11, de_qualifier_losers: 12,
  swiss: 20,
  single_elimination: 30,
  double_elimination_winners: 31, double_elimination_losers: 32,
  double_elimination_grand_final: 33,
};

function stageSort(a: string, b: string): number {
  const oa = STAGE_ORDER[a] ?? 99;
  const ob = STAGE_ORDER[b] ?? 99;
  return oa - ob || a.localeCompare(b);
}

function stageName(stage: string): string {
  if (stage === "single_elimination") return "Single Elimination";
  if (stage === "double_elimination_winners") return "DE Winners";
  if (stage === "double_elimination_losers") return "DE Losers";
  if (stage === "double_elimination_grand_final") return "Grand Final";
  if (stage === "swiss") return "Swiss";
  if (stage === "se_qualifier") return "SE Qualifier";
  if (stage === "de_qualifier_winners") return "DEQ Winners";
  if (stage === "de_qualifier_losers") return "DEQ Losers";
  const gm = stage.match(/^group_(\d+)$/);
  if (gm) return `Group ${gm[1]}`;
  return stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Replay slot types ─────────────────────────────────────────────────────────

type SlotState =
  | { status: "locked" }
  | { status: "idle" }
  | { status: "analyzing" }
  | { status: "done"; homeTeamWon: boolean; replayId: string | null; stats: AnalyzedGameStat[] }
  | { status: "unmatched"; unmatchedNames: string[]; file: File }
  | { status: "error"; message: string };

// ── Replay section ────────────────────────────────────────────────────────────

function ReplaySection({
  matchId,
  bestOf,
  players,
  onResult,
}: {
  matchId: string;
  bestOf: number;
  players: PlayerOption[];
  onResult: (r: { complete: boolean; homeWins: number; awayWins: number; games: SubmittedGame[] }) => void;
}) {
  const needed = Math.ceil(bestOf / 2);
  const [slots, setSlots] = useState<SlotState[]>(() =>
    Array.from({ length: bestOf }, (_, i) =>
      i === 0 ? { status: "idle" as const } : { status: "locked" as const }
    )
  );
  const [akaNames, setAkaNames] = useState<Record<number, Record<string, string>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSlotRef = useRef<number>(-1);

  // Notify parent of the replay-derived series result + the resolved game stats
  useEffect(() => {
    const done = slots
      .map((s, idx) => ({ s, idx }))
      .filter((x) => x.s.status === "done") as { s: Extract<SlotState, { status: "done" }>; idx: number }[];
    const h = done.filter((x) => x.s.homeTeamWon).length;
    const a = done.filter((x) => !x.s.homeTeamWon).length;
    const games: SubmittedGame[] = done.map((x) => ({
      gameNumber: x.idx + 1,
      replayId: x.s.replayId,
      stats: x.s.stats,
    }));
    onResult({ complete: h >= needed || a >= needed, homeWins: h, awayWins: a, games });
  }, [slots, needed, onResult]);

  const processFile = useCallback(
    async (file: File, slotIndex: number, overrides: Record<string, string>) => {
      setSlots((prev) => {
        const next = [...prev];
        next[slotIndex] = { status: "analyzing" };
        return next;
      });

      try {
        const fd = new FormData();
        fd.append("replay", file);
        const result = await adminAnalyzeGameReplay(fd, matchId, slotIndex + 1, overrides);

        setSlots((prev) => {
          const next = [...prev];
          if (result.error) {
            next[slotIndex] = { status: "error", message: result.error };
          } else if (result.unmatched?.length) {
            next[slotIndex] = { status: "unmatched", unmatchedNames: result.unmatched, file };
          } else if (
            result.replayId &&
            next.some((s, idx) => idx !== slotIndex && s.status === "done" && s.replayId === result.replayId)
          ) {
            next[slotIndex] = { status: "error", message: "This replay was already uploaded for another game." };
          } else {
            next[slotIndex] = {
              status: "done",
              homeTeamWon: result.homeTeamWon!,
              replayId: result.replayId ?? null,
              stats: result.stats ?? [],
            };
            // Unlock next slot if series isn't decided yet
            if (slotIndex + 1 < bestOf && next[slotIndex + 1].status === "locked") {
              const h = next.filter(
                (s): s is { status: "done"; homeTeamWon: boolean; replayId: string | null; stats: AnalyzedGameStat[] } => s.status === "done" && s.homeTeamWon,
              ).length;
              const a = next.filter(
                (s): s is { status: "done"; homeTeamWon: boolean; replayId: string | null; stats: AnalyzedGameStat[] } => s.status === "done" && !s.homeTeamWon,
              ).length;
              if (h < needed && a < needed) next[slotIndex + 1] = { status: "idle" };
            }
          }
          return next;
        });
      } catch (err) {
        setSlots((prev) => {
          const next = [...prev];
          next[slotIndex] = {
            status: "error",
            message: err instanceof Error ? err.message : "Analysis failed",
          };
          return next;
        });
      }
    },
    [matchId, bestOf, needed],
  );

  function onDrop(e: React.DragEvent, i: number) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file, i, akaNames[i] ?? {});
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const i = activeSlotRef.current;
    if (file && i >= 0) processFile(file, i, akaNames[i] ?? {});
    e.target.value = "";
  }

  function openFilePicker(i: number) {
    activeSlotRef.current = i;
    fileInputRef.current?.click();
  }

  function setAka(slotIndex: number, replayName: string, playerId: string) {
    setAkaNames((prev) => ({
      ...prev,
      [slotIndex]: { ...(prev[slotIndex] ?? {}), [replayName]: playerId },
    }));
  }

  function removeSlot(slotIndex: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = { status: "idle" };
      for (let j = slotIndex + 1; j < next.length; j++) next[j] = { status: "locked" };
      return next;
    });
    setAkaNames((prev) => { const next = { ...prev }; delete next[slotIndex]; return next; });
  }

  const homeWins = slots.filter((s) => s.status === "done" && s.homeTeamWon).length;
  const awayWins = slots.filter((s) => s.status === "done" && !s.homeTeamWon).length;

  return (
    <div className="px-4 pb-3 space-y-1.5 pl-20 border-t border-zinc-800/40 pt-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".replay"
        className="hidden"
        onChange={onFileChange}
      />

      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
        Replays · {homeWins} – {awayWins}
      </p>

      {slots.map((slot, i) => {
        if (slot.status === "locked") return null;

        const slotAka = akaNames[i] ?? {};
        const unmatchedNames = slot.status === "unmatched" ? slot.unmatchedNames : [];
        const allMapped = slot.status === "unmatched" && unmatchedNames.every((n) => slotAka[n]);

        return (
          <div key={i} className="space-y-1">
            <div
              onDragOver={slot.status === "idle" ? (e) => e.preventDefault() : undefined}
              onDrop={slot.status === "idle" ? (e) => onDrop(e, i) : undefined}
              onClick={
                slot.status === "idle"
                  ? () => openFilePicker(i)
                  : slot.status === "error"
                  ? () => setSlots((prev) => { const n = [...prev]; n[i] = { status: "idle" }; return n; })
                  : undefined
              }
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2 border select-none transition-colors text-xs",
                slot.status === "idle" &&
                  "border-dashed border-indigo-500/50 bg-indigo-950/20 cursor-pointer hover:border-indigo-400/60 hover:bg-indigo-950/30",
                (slot.status === "analyzing" || slot.status === "done") &&
                  "border-zinc-700 bg-zinc-800",
                slot.status === "unmatched" && "border-amber-700/50 bg-amber-950/20",
                slot.status === "error" && "border-red-700/40 bg-red-950/10 cursor-pointer",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                className={`font-semibold uppercase tracking-wider w-8 shrink-0 ${
                  slot.status === "idle" ? "text-indigo-400" : "text-zinc-500"
                }`}
              >
                G{i + 1}
              </span>

              {slot.status === "idle" && (
                <span className="text-zinc-400">
                  Drop <span className="font-mono text-indigo-300">.replay</span> or click to browse
                </span>
              )}

              {slot.status === "analyzing" && (
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <span className="inline-block w-3 h-3 border-2 border-zinc-600 border-t-indigo-400 rounded-full animate-spin shrink-0" />
                  Analyzing…
                </span>
              )}

              {slot.status === "done" && (
                <>
                  <span className="flex-1 text-zinc-300">
                    {slot.homeTeamWon ? "Home" : "Away"} won
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                      slot.homeTeamWon
                        ? "bg-indigo-700/40 text-indigo-300"
                        : "bg-rose-700/40 text-rose-300"
                    }`}
                  >
                    {slot.homeTeamWon ? "Home" : "Away"}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSlot(i); }}
                    className="shrink-0 text-[10px] text-zinc-500 hover:text-red-400 transition-colors ml-1"
                    title="Remove replay"
                  >
                    ✕
                  </button>
                </>
              )}

              {slot.status === "unmatched" && (
                <>
                  <span className="flex-1 text-amber-400">
                    {slot.unmatchedNames.length} unrecognized player
                    {slot.unmatchedNames.length !== 1 ? "s" : ""} — set aka names below
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSlot(i); }}
                    className="shrink-0 text-[10px] text-zinc-500 hover:text-red-400 transition-colors ml-1"
                    title="Remove replay"
                  >
                    ✕
                  </button>
                </>
              )}

              {slot.status === "error" && (
                <span className="flex-1 text-red-400">
                  {slot.message} — click to retry
                </span>
              )}
            </div>

            {/* Aka name overrides for unmatched players */}
            {slot.status === "unmatched" && (
              <div className="ml-3 p-2.5 bg-amber-950/10 border border-amber-700/20 rounded-lg space-y-2">
                <p className="text-[10px] text-amber-500">
                  These players aren&apos;t in the roster. Map them to the correct registered player:
                </p>
                {unmatchedNames.map((name) => {
                  // Players already chosen for another unmatched name in this game,
                  // so each registered player can only be mapped once per game.
                  const takenIds = new Set(
                    Object.entries(slotAka)
                      .filter(([n, id]) => n !== name && id)
                      .map(([, id]) => id),
                  );
                  return (
                  <div key={name} className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-mono text-amber-300 shrink-0 truncate max-w-[8rem]"
                      title={name}
                    >
                      {name}
                    </span>
                    <span className="text-[10px] text-zinc-600 shrink-0">→</span>
                    <select
                      value={slotAka[name] ?? ""}
                      onChange={(e) => setAka(i, name, e.target.value)}
                      className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">Select player…</option>
                      {players.filter((p) => !takenIds.has(p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  );
                })}
                <button
                  onClick={() => processFile(slot.file, i, { ...(akaNames[i] ?? {}) })}
                  disabled={!allMapped}
                  className="mt-0.5 px-2.5 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-[10px] font-medium rounded transition-colors"
                >
                  Retry with overrides
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── MatchEntry ────────────────────────────────────────────────────────────────

function MatchEntry({
  match,
  onReported,
}: {
  match: MatchData;
  onReported: (id: string, summary: string) => void;
}) {
  const [homeScore, setHomeScore] = useState(
    match.pendingHomeScore !== null ? String(match.pendingHomeScore) : ""
  );
  const [awayScore, setAwayScore] = useState(
    match.pendingAwayScore !== null ? String(match.pendingAwayScore) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dqTarget, setDqTarget] = useState<"home" | "away" | null>(null);
  const [isDqing, startDqTransition] = useTransition();
  const [showReplays, setShowReplays] = useState(false);
  const [replayResult, setReplayResult] = useState<{ complete: boolean; h: number; a: number; games: SubmittedGame[] }>({ complete: false, h: 0, a: 0, games: [] });
  const [showWarning, setShowWarning] = useState(false);

  const replaysComplete = replayResult.complete;

  // Once enough replays decide the series, use their result as the series score.
  // Stable identity so ReplaySection's effect doesn't re-fire in a loop.
  const handleReplayResult = useCallback((r: { complete: boolean; homeWins: number; awayWins: number; games: SubmittedGame[] }) => {
    setReplayResult({ complete: r.complete, h: r.homeWins, a: r.awayWins, games: r.games });
    if (r.complete) {
      setHomeScore(String(r.homeWins));
      setAwayScore(String(r.awayWins));
    }
  }, []);

  function doSubmit(overrideH?: number, overrideA?: number) {
    const h = overrideH ?? parseInt(homeScore);
    const a = overrideA ?? parseInt(awayScore);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) { setError("Enter valid scores."); return; }
    if (h === a) { setError("Scores can't be equal."); return; }
    setError(null);
    setShowWarning(false);
    startTransition(async () => {
      const res = await reportMatchResult(match.id, h, a, replayResult.games);
      if (!res.ok) { setError(res.message); return; }
      onReported(match.id, res.message);
    });
  }

  function handleSubmitClick(overrideH?: number, overrideA?: number) {
    // Pre-validate scores first so errors surface immediately
    const h = overrideH ?? parseInt(homeScore);
    const a = overrideA ?? parseInt(awayScore);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) { setError("Enter valid scores."); return; }
    if (h === a) { setError("Scores can't be equal."); return; }
    setError(null);

    if (!replaysComplete) {
      setShowWarning(true);
      return;
    }
    doSubmit(overrideH, overrideA);
  }

  function handleDq(side: "home" | "away") {
    const teamId = side === "home" ? match.homeTeamId : match.awayTeamId;
    const teamName = side === "home" ? match.homeTeamName : match.awayTeamName;
    setError(null);
    startDqTransition(async () => {
      const res = await dqTeamFromMatch(match.id, teamId);
      if (!res.ok) { setError(res.message); setDqTarget(null); return; }
      onReported(match.id, `DQ — ${teamName} forfeited · ${res.message}`);
    });
  }

  const scheduleLabel = match.scheduledAt
    ? new Date(match.scheduledAt).toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      })
    : null;

  const dqTargetName = dqTarget === "home" ? match.homeTeamName : match.awayTeamName;
  const isConfirmedScore = match.scoreConfirmed && match.pendingHomeScore !== null;

  return (
    <div className="border-b border-zinc-800/60 last:border-0">
      {/* Main row */}
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-start w-16 shrink-0">
            <span className="text-[10px] font-semibold text-zinc-500 tabular-nums">
              R{match.round} M{match.matchNumber}
            </span>
            <span className="text-[10px] font-medium text-indigo-400">
              BO{match.bestOf}
            </span>
          </div>

          {/* Home team + DQ button */}
          <div className="flex-1 flex items-center justify-end gap-1.5 min-w-0">
            <button
              onClick={() => setDqTarget(dqTarget === "home" ? null : "home")}
              className="shrink-0 text-[10px] font-bold text-red-500 hover:text-red-400 border border-red-800/50 hover:border-red-600/60 rounded px-1.5 py-0.5 transition-colors"
            >
              DQ
            </button>
            <span className="text-sm font-medium text-white truncate text-right">{match.homeTeamName}</span>
          </div>

          {/* Score */}
          {isConfirmedScore ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 rounded px-2 py-0.5 whitespace-nowrap">
                ✓ captains agreed
              </span>
              <span className="text-sm font-bold font-mono text-white tabular-nums">
                {match.pendingHomeScore} – {match.pendingAwayScore}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number" min={0} max={9} value={homeScore}
                onChange={e => setHomeScore(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmitClick()}
                placeholder="—"
                className={`w-10 bg-zinc-800 border rounded px-2 py-1 text-center text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] ${
                  match.pendingHomeScore !== null ? "border-amber-600/60" : "border-zinc-700"
                }`}
              />
              <span className="text-zinc-600 text-sm">–</span>
              <input
                type="number" min={0} max={9} value={awayScore}
                onChange={e => setAwayScore(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmitClick()}
                placeholder="—"
                className={`w-10 bg-zinc-800 border rounded px-2 py-1 text-center text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] ${
                  match.pendingAwayScore !== null ? "border-amber-600/60" : "border-zinc-700"
                }`}
              />
            </div>
          )}

          {/* Away team + DQ button */}
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium text-white truncate">{match.awayTeamName}</span>
            <button
              onClick={() => setDqTarget(dqTarget === "away" ? null : "away")}
              className="shrink-0 text-[10px] font-bold text-red-500 hover:text-red-400 border border-red-800/50 hover:border-red-600/60 rounded px-1.5 py-0.5 transition-colors"
            >
              DQ
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {error && <span className="text-xs text-red-400">{error}</span>}
            <button
              onClick={() =>
                isConfirmedScore
                  ? handleSubmitClick(match.pendingHomeScore!, match.pendingAwayScore!)
                  : replaysComplete
                  ? handleSubmitClick(replayResult.h, replayResult.a)
                  : handleSubmitClick()
              }
              disabled={
                isPending ||
                (!isConfirmedScore && !replaysComplete && (!homeScore || !awayScore))
              }
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {isPending ? "Saving…" : "Submit"}
            </button>
            {/* Replay toggle */}
            <button
              onClick={() => setShowReplays(r => !r)}
              title="Upload replays for stat tracking"
              className={`flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-1 transition-colors ${
                showReplays
                  ? "text-indigo-300 bg-indigo-900/40"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Replays
            </button>
          </div>
        </div>

        {/* DQ inline confirmation */}
        {dqTarget && (
          <div className="flex items-center gap-3 pl-20 py-1">
            <span className="text-xs text-red-400">
              Forfeit this match for <span className="font-semibold">{dqTargetName}</span>?
            </span>
            <button
              onClick={() => handleDq(dqTarget)}
              disabled={isDqing}
              className="px-2.5 py-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
            >
              {isDqing ? "Processing…" : "Confirm DQ"}
            </button>
            <button
              onClick={() => setDqTarget(null)}
              disabled={isDqing}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {match.pendingHomeScore !== null && !match.scoreConfirmed && (
          <p className="text-[10px] pl-20 text-amber-400">
            Captain submitted: {match.pendingHomeScore} – {match.pendingAwayScore} · awaiting opponent confirmation
          </p>
        )}

        {scheduleLabel && (
          <p className={`text-[10px] pl-20 ${match.scheduleAccepted ? "text-emerald-400" : "text-amber-400"}`}>
            {match.scheduleAccepted ? "✅" : "📅"} {scheduleLabel}
            {!match.scheduleAccepted && <span className="text-zinc-600 ml-1">· pending acceptance</span>}
          </p>
        )}

        {/* Warning: no replays uploaded */}
        {showWarning && (
          <div className="pl-20 flex items-center gap-3 py-1">
            <span className="text-xs text-amber-400">
              Stats won&apos;t be calculated for this series — no replays uploaded.
            </span>
            <button
              onClick={() => doSubmit(
                isConfirmedScore ? match.pendingHomeScore! : undefined,
                isConfirmedScore ? match.pendingAwayScore! : undefined,
              )}
              disabled={isPending}
              className="px-2.5 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
            >
              Submit anyway
            </button>
            <button
              onClick={() => setShowWarning(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Replay upload section */}
      {showReplays && (
        <ReplaySection
          matchId={match.id}
          bestOf={match.bestOf}
          players={match.players}
          onResult={handleReplayResult}
        />
      )}
    </div>
  );
}

function StageGroup({
  stage, matches, onReported,
}: {
  stage: string;
  matches: MatchData[];
  onReported: (id: string, summary: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 text-left"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{stageName(stage)}</p>
          <span className="text-[10px] text-zinc-600">{matches.length} match{matches.length !== 1 ? "es" : ""}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`text-zinc-600 transition-transform duration-150 ${collapsed ? "-rotate-90" : "rotate-0"}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && matches.map(m => (
        <MatchEntry key={m.id} match={m} onReported={onReported} />
      ))}
    </div>
  );
}

export function MatchReporter({
  matches: initialMatches,
}: {
  matches: MatchData[];
}) {
  const [pending, setPending] = useState(initialMatches);
  const [reported, setReported] = useState<{ id: string; summary: string }[]>([]);

  function onReported(id: string, summary: string) {
    setPending(ms => ms.filter(m => m.id !== id));
    setReported(rs => [{ id, summary }, ...rs]);
  }

  const byStage = pending.reduce<Record<string, MatchData[]>>((acc, m) => {
    if (!acc[m.stage]) acc[m.stage] = [];
    acc[m.stage].push(m);
    return acc;
  }, {});

  const sortedStages = Object.keys(byStage).sort(stageSort);

  if (pending.length === 0 && reported.length === 0) {
    return <p className="text-sm text-zinc-500">No scheduled matches to report.</p>;
  }

  return (
    <div className="space-y-3">
      {sortedStages.map(stage => (
        <StageGroup key={stage} stage={stage} matches={byStage[stage]} onReported={onReported} />
      ))}

      {reported.length > 0 && (
        <div className="pt-1 space-y-1">
          {reported.map(r => (
            <p key={r.id} className="text-xs text-emerald-400 px-1">✓ {r.summary}</p>
          ))}
        </div>
      )}

      {pending.length === 0 && (
        <p className="text-sm text-zinc-500">All matches reported.</p>
      )}
    </div>
  );
}
