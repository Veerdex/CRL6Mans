"use client";

import { useState, useRef, useCallback, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  submitSeriesResult,
  confirmSeriesResult,
  cancelSeriesSubmission,
  uploadGameReplay,
  processScoreConfirmationsNow,
} from "./series-actions";
import type { AnalyzedGameStat, SubmittedGame } from "@/app/dashboard/admin/match-actions";

const TOURNAMENT_SCORE_CONFIRM_WINDOW_MS = 5 * 60 * 1000;
const SEASON_SCORE_CONFIRM_WINDOW_MS = 15 * 60 * 1000;

// Ticks every second; when the confirm window elapses (15 min for a standalone
// season, 5 min for a discrete tournament — must mirror processExpiredScoreConfirmations
// in app/lib/discord-bot.ts) it asks the server to auto-finalize. Returns remaining ms
// (null when no pending submission).
function useConfirmCountdown(scoreSubmittedAt: string | null, isTournament: boolean): number | null {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const windowMs = isTournament ? TOURNAMENT_SCORE_CONFIRM_WINDOW_MS : SEASON_SCORE_CONFIRM_WINDOW_MS;
  const deadline = scoreSubmittedAt ? new Date(scoreSubmittedAt).getTime() + windowMs : null;
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  useEffect(() => {
    if (deadline !== null && nowMs > deadline) {
      processScoreConfirmationsNow().then(() => router.refresh()).catch(() => {});
    }
  }, [nowMs, deadline, router]);
  return deadline !== null ? Math.max(0, deadline - nowMs) : null;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type SeriesTeamInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_offset_x: number;
  logo_offset_y: number;
  avgMmr: number;
  players: { id: string; name: string; rv: number }[];
};

type SlotState =
  | { status: "locked" }
  | { status: "waiting" }
  | { status: "analyzing" }
  | { status: "done"; homeWon: boolean; replayId: string | null; stats: AnalyzedGameStat[] }
  | { status: "error"; message: string };

interface Props {
  matchId: string | null;
  homeTeam: SeriesTeamInfo | null;
  awayTeam: SeriesTeamInfo | null;
  bestOf: number;
  myTeamId: string;
  pendingHomeScore: number | null;
  pendingAwayScore: number | null;
  scoreSubmittedByTeamId: string | null;
  scoreConfirmed: boolean;
  scoreSubmittedAt?: string | null;
  opponentNotReady?: boolean;
  opponentName?: string | null;
  isTournament?: boolean;
  statsEnabled?: boolean;
}

// Every legal final score for a Bo-N: the winner takes exactly `needed` games,
// the loser anything short of that. The server runs validateSeriesScore on the
// submission either way, so offering only these keeps a stats-free report from
// being rejected for a score that was never selectable.
function legalSeriesScores(bestOf: number): [number, number][] {
  const needed = Math.ceil(bestOf / 2);
  const out: [number, number][] = [];
  for (let loser = needed - 1; loser >= 0; loser--) out.push([needed, loser]);
  for (let loser = 0; loser < needed; loser++) out.push([loser, needed]);
  return out;
}

function initSlots(bestOf: number): SlotState[] {
  return Array.from({ length: bestOf }, (_, i) =>
    i === 0 ? { status: "waiting" as const } : { status: "locked" as const }
  );
}

function toWins(slots: SlotState[]): [number, number] {
  const done = slots.filter((s) => s.status === "done") as Extract<SlotState, { status: "done" }>[];
  return [done.filter(s => s.homeWon).length, done.filter(s => !s.homeWon).length];
}

function isSeriesOver(slots: SlotState[], bestOf: number): boolean {
  const needed = Math.ceil(bestOf / 2);
  const [h, a] = toWins(slots);
  return h >= needed || a >= needed;
}

const GRADIENTS = [
  "from-indigo-600 to-indigo-800", "from-rose-600 to-rose-800",
  "from-emerald-600 to-emerald-800", "from-amber-600 to-amber-800",
  "from-cyan-600 to-cyan-800", "from-purple-600 to-purple-800",
  "from-orange-600 to-orange-800", "from-teal-600 to-teal-800",
];

function TeamLogo({ team, size }: { team: SeriesTeamInfo | null; size: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-16 h-16" : "w-10 h-10";
  const text = size === "lg" ? "text-2xl" : "text-sm";
  if (!team) return <div className={`${dim} rounded-xl bg-zinc-800 shrink-0`} />;
  if (team.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.logo_url} alt={team.name}
        className={`${dim} rounded-xl object-cover shrink-0`}
        style={{ objectPosition: `${team.logo_offset_x ?? 50}% ${team.logo_offset_y ?? 50}%` }}
      />
    );
  }
  const num = parseInt(team.name.replace(/\D+/g, "") || "1");
  const g = GRADIENTS[(num - 1) % GRADIENTS.length];
  return (
    <div className={`${dim} rounded-xl bg-gradient-to-br ${g} flex items-center justify-center ${text} font-bold text-white shrink-0`}>
      {num}
    </div>
  );
}

function TeamColumn({ team, side }: { team: SeriesTeamInfo | null; side: "home" | "away" }) {
  const align = side === "home" ? "items-end text-right" : "items-start text-left";
  return (
    <div className={`flex flex-col gap-2 min-w-0 w-32 ${align}`}>
      <TeamLogo team={team} size="lg" />
      <p className="text-sm font-semibold text-white truncate max-w-full">
        {team?.name ?? "TBD"}
      </p>
      <p className="text-xs text-zinc-500">
        {team && team.avgMmr > 0 ? `avg ${team.avgMmr.toLocaleString()} RV` : "—"}
      </p>
      {team && team.players.length > 0 && (
        <div className={`flex flex-col gap-0.5 ${align}`}>
          {team.players.map((p) => (
            <p key={p.id} className="text-[11px] text-zinc-400 truncate max-w-full">
              {p.name} <span className="text-zinc-600">· {p.rv.toLocaleString()}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Confirmed / awaiting-admin view ────────────────────────────────────────────

function ConfirmedView({
  homeTeam, awayTeam, pendingHomeScore, pendingAwayScore, submittedByUs,
}: {
  homeTeam: SeriesTeamInfo | null;
  awayTeam: SeriesTeamInfo | null;
  pendingHomeScore: number;
  pendingAwayScore: number;
  submittedByUs: boolean;
}) {
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        <TeamColumn team={homeTeam} side="home" />
        <div className="flex-1 flex flex-col items-center justify-center pt-3 gap-1.5 min-w-0">
          <p className="text-3xl font-bold font-mono text-white tabular-nums">
            {pendingHomeScore} – {pendingAwayScore}
          </p>
        </div>
        <TeamColumn team={awayTeam} side="away" />
      </div>
      <div className="bg-emerald-950/40 border border-emerald-700/40 rounded-lg px-4 py-3 text-center space-y-1">
        <p className="text-sm font-semibold text-emerald-300">Both captains confirmed this result</p>
        <p className="text-xs text-emerald-600">
          {submittedByUs
            ? "Waiting for an admin to finalise the match."
            : "Waiting for an admin to finalise the match."}
        </p>
      </div>
    </div>
  );
}

// ── Pending-confirmation view (shown to whichever captain submitted) ───────────

function WaitingView({
  homeTeam, awayTeam, pendingHomeScore, pendingAwayScore, matchId, scoreSubmittedAt, isTournament,
}: {
  homeTeam: SeriesTeamInfo | null;
  awayTeam: SeriesTeamInfo | null;
  pendingHomeScore: number;
  pendingAwayScore: number;
  matchId: string;
  scoreSubmittedAt: string | null;
  isTournament: boolean;
}) {
  const router = useRouter();
  const [cancelling, startCancel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remaining = useConfirmCountdown(scoreSubmittedAt, isTournament);

  function handleCancel() {
    setError(null);
    startCancel(async () => {
      const res = await cancelSeriesSubmission(matchId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        <TeamColumn team={homeTeam} side="home" />
        <div className="flex-1 flex flex-col items-center justify-center pt-3 gap-1.5 min-w-0">
          <p className="text-3xl font-bold font-mono text-white tabular-nums">
            {pendingHomeScore} – {pendingAwayScore}
          </p>
        </div>
        <TeamColumn team={awayTeam} side="away" />
      </div>
      <div className="bg-amber-950/40 border border-amber-700/40 rounded-lg px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-amber-300">Result submitted — awaiting opponent confirmation</p>
        <p className="text-xs text-amber-500">
          {remaining !== null && remaining > 0
            ? <>Auto-submits in <span className="font-mono font-semibold text-amber-300">{fmtCountdown(remaining)}</span> if your opponent doesn&apos;t confirm.</>
            : "Finalising…"}
        </p>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs text-amber-500 hover:text-amber-300 underline underline-offset-2 transition-colors disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Retract submission"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Confirm-result modal (shown when the confirming captain clicks Confirm) ───

function ConfirmResultModal({
  won, myWins, theirWins, confirming, cancelling, error, onConfirm, onNo, onClose,
}: {
  won: boolean;
  myWins: number;
  theirWins: number;
  confirming: boolean;
  cancelling: boolean;
  error: string | null;
  onConfirm: () => void;
  onNo: () => void;
  onClose: () => void;
}) {
  const [cooldown, setCooldown] = useState(3);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const busy = confirming || cancelling;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-2">
          <p className={`text-2xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}>
            {won ? "You won!" : "You lost!"}
          </p>
          <p className="text-4xl font-bold font-mono text-white tabular-nums">
            {myWins} – {theirWins}
          </p>
          <p className="text-xs text-zinc-500">
            This is the series result your opponent submitted.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            disabled={cooldown > 0 || busy}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {confirming
              ? "Submitting…"
              : cooldown > 0
                ? `Is this result correct? (${cooldown})`
                : "Is this result correct?"}
          </button>
          <button
            onClick={onNo}
            disabled={busy}
            className="px-4 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {cancelling ? "Cancelling…" : "No"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      </div>
    </div>
  );
}

// ── Opponent-submitted view (shown to the confirming captain) ─────────────────

function OpponentSubmittedView({
  homeTeam, awayTeam, pendingHomeScore, pendingAwayScore, submitterTeamName, matchId, myTeamId, scoreSubmittedAt, isTournament,
}: {
  homeTeam: SeriesTeamInfo | null;
  awayTeam: SeriesTeamInfo | null;
  pendingHomeScore: number;
  pendingAwayScore: number;
  submitterTeamName: string;
  matchId: string;
  myTeamId: string;
  scoreSubmittedAt: string | null;
  isTournament: boolean;
}) {
  const router = useRouter();
  const [confirming, startConfirm] = useTransition();
  const [disputing, startDispute] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const remaining = useConfirmCountdown(scoreSubmittedAt, isTournament);

  const iAmHome = myTeamId === homeTeam?.id;
  const myWins = iAmHome ? pendingHomeScore : pendingAwayScore;
  const theirWins = iAmHome ? pendingAwayScore : pendingHomeScore;
  const won = myWins > theirWins;

  function handleConfirm() {
    setError(null);
    startConfirm(async () => {
      const res = await confirmSeriesResult(matchId);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleNo() {
    setError(null);
    startDispute(async () => {
      const res = await cancelSeriesSubmission(matchId);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        <TeamColumn team={homeTeam} side="home" />
        <div className="flex-1 flex flex-col items-center justify-center pt-3 gap-1.5 min-w-0">
          <p className="text-3xl font-bold font-mono text-white tabular-nums">
            {pendingHomeScore} – {pendingAwayScore}
          </p>
        </div>
        <TeamColumn team={awayTeam} side="away" />
      </div>
      <div className="bg-indigo-950/40 border border-indigo-700/40 rounded-lg px-4 py-3 space-y-3">
        <div>
          <p className="text-sm font-semibold text-indigo-300">
            {submitterTeamName} submitted this result
          </p>
          <p className="text-xs text-indigo-500 mt-0.5">
            Confirm if the score is correct, or dispute to start over.
          </p>
          <p className="text-xs text-amber-400 mt-1">
            {remaining !== null && remaining > 0
              ? <>Auto-submits in <span className="font-mono font-semibold">{fmtCountdown(remaining)}</span> if you don&apos;t respond.</>
              : "Finalising…"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => { setError(null); setShowModal(true); }}
            disabled={confirming || disputing}
            className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Confirm Result
          </button>
          <button
            onClick={handleNo}
            disabled={confirming || disputing}
            className="px-4 py-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {disputing ? "Disputing…" : "Dispute"}
          </button>
          {error && !showModal && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {showModal && (
        <ConfirmResultModal
          won={won}
          myWins={myWins}
          theirWins={theirWins}
          confirming={confirming}
          cancelling={disputing}
          error={error}
          onConfirm={handleConfirm}
          onNo={handleNo}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function SeriesReplayPanel({
  matchId, homeTeam, awayTeam, bestOf,
  myTeamId, pendingHomeScore, pendingAwayScore, scoreSubmittedByTeamId, scoreConfirmed,
  scoreSubmittedAt = null,
  opponentNotReady = false, opponentName = null,
  isTournament = false, statsEnabled = true,
}: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<SlotState[]>(() => initSlots(bestOf));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pickedScore, setPickedScore] = useState<[number, number] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSlotRef = useRef<number>(-1);

  const needed = Math.ceil(bestOf / 2);
  const [homeWins, awayWins] = toWins(slots);
  const seriesOver = isSeriesOver(slots, bestOf);

  const handleFile = useCallback(async (file: File, slotIndex: number) => {
    if (!matchId) return;

    if (!file.name.endsWith(".replay")) {
      setSlots(prev => {
        const next = [...prev];
        next[slotIndex] = { status: "error", message: "File must be a .replay" };
        return next;
      });
      return;
    }

    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { status: "analyzing" };
      return next;
    });

    try {
      const fd = new FormData();
      fd.append("replay", file);
      const result = await uploadGameReplay(fd, matchId, slotIndex + 1);
      if (result.error) throw new Error(result.error);
      setSlots(prev => {
        const next = [...prev];
        if (
          result.replayId &&
          next.some((s, idx) => idx !== slotIndex && s.status === "done" && s.replayId === result.replayId)
        ) {
          next[slotIndex] = { status: "error", message: "This replay was already uploaded for another game." };
          return next;
        }
        next[slotIndex] = {
          status: "done",
          homeWon: result.homeTeamWon!,
          replayId: result.replayId ?? null,
          stats: result.stats ?? [],
        };
        const done = next.filter((s) => s.status === "done") as Extract<SlotState, { status: "done" }>[];
        const h = done.filter(s => s.homeWon).length;
        const a = done.filter(s => !s.homeWon).length;
        if (h < needed && a < needed && slotIndex + 1 < bestOf) {
          next[slotIndex + 1] = { status: "waiting" };
        }
        return next;
      });
    } catch (err) {
      setSlots(prev => {
        const next = [...prev];
        next[slotIndex] = {
          status: "error",
          message: err instanceof Error ? err.message : "Analysis failed",
        };
        return next;
      });
    }
  }, [needed, bestOf, matchId]);

  function onDrop(e: React.DragEvent, slotIndex: number) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, slotIndex);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && activeSlotRef.current >= 0) handleFile(file, activeSlotRef.current);
    e.target.value = "";
  }

  function openFilePicker(slotIndex: number) {
    activeSlotRef.current = slotIndex;
    fileInputRef.current?.click();
  }

  function retrySlot(slotIndex: number) {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { status: "waiting" };
      return next;
    });
  }

  async function handleScoreOnlySubmit() {
    if (!matchId || !pickedScore) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await submitSeriesResult(matchId, pickedScore[0], pickedScore[1]);
    setSubmitting(false);
    if (res.error) { setSubmitError(res.error); return; }
    setSubmitted(true);
    router.refresh();
  }

  async function handleSubmit() {
    if (!matchId) return;
    setSubmitting(true);
    setSubmitError(null);
    const games: SubmittedGame[] = slots
      .map((s, idx) => ({ s, idx }))
      .filter((x) => x.s.status === "done")
      .map((x) => {
        const d = x.s as Extract<SlotState, { status: "done" }>;
        return { gameNumber: x.idx + 1, replayId: d.replayId, stats: d.stats };
      });
    const res = await submitSeriesResult(matchId, homeWins, awayWins, games);
    setSubmitting(false);
    if (res.error) { setSubmitError(res.error); return; }
    setSubmitted(true);
    router.refresh();
  }

  // ── Header ──

  const header = (
    <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-zinc-300">Score Confirmation</h2>
      <span className="text-xs text-zinc-500">Bo{bestOf}</span>
    </div>
  );

  // ── No match / no opponent ──

  if (!matchId) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <p className="text-sm text-zinc-500 px-5 py-8 text-center">
          No match scheduled yet — check back once your bracket is set.
        </p>
      </div>
    );
  }

  if (!homeTeam || !awayTeam) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <p className="text-sm text-zinc-500 px-5 py-8 text-center">
          Waiting for opponent to be determined
        </p>
      </div>
    );
  }

  // ── Confirmed (both captains agreed, admin to finalise) ──

  if (scoreConfirmed && pendingHomeScore !== null && pendingAwayScore !== null) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <ConfirmedView
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          pendingHomeScore={pendingHomeScore}
          pendingAwayScore={pendingAwayScore}
          submittedByUs={scoreSubmittedByTeamId === myTeamId}
        />
      </div>
    );
  }

  // ── My team submitted; waiting for opponent to confirm ──

  if (pendingHomeScore !== null && pendingAwayScore !== null && scoreSubmittedByTeamId === myTeamId) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <WaitingView
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          pendingHomeScore={pendingHomeScore}
          pendingAwayScore={pendingAwayScore}
          matchId={matchId}
          scoreSubmittedAt={scoreSubmittedAt ?? null}
          isTournament={isTournament}
        />
      </div>
    );
  }

  // ── Opponent submitted; this captain needs to confirm or dispute ──

  if (pendingHomeScore !== null && pendingAwayScore !== null && scoreSubmittedByTeamId !== null) {
    const submitterTeam = scoreSubmittedByTeamId === homeTeam.id ? homeTeam : awayTeam;
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <OpponentSubmittedView
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          pendingHomeScore={pendingHomeScore}
          pendingAwayScore={pendingAwayScore}
          submitterTeamName={submitterTeam.name}
          matchId={matchId}
          myTeamId={myTeamId}
          scoreSubmittedAt={scoreSubmittedAt ?? null}
          isTournament={isTournament}
        />
      </div>
    );
  }

  // ── Opponent still has an earlier match to finish before they play us ──

  if (opponentNotReady) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <div className="px-5 py-8 text-center space-y-2">
          <p className="text-3xl">⏳</p>
          <p className="text-sm font-semibold text-amber-300">
            Waiting on {opponentName ?? "your opponent"}
          </p>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            {`${opponentName ?? "Your opponent"} still has an earlier match to play before they face you. You'll be able to report the result here once they've finished it.`}
          </p>
        </div>
      </div>
    );
  }

  // ── Upload flow (no pending result yet) ──

  if (submitted) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <div className="px-5 py-8 text-center space-y-1">
          <p className="text-sm font-semibold text-amber-400">Result submitted — awaiting opponent confirmation</p>
          <p className="text-xs text-zinc-500">The opposing captain will see your claimed score on their team page.</p>
        </div>
      </div>
    );
  }

  // ── Score-only flow (event isn't tracking stats, so no replays to upload) ──

  if (!statsEnabled) {
    const [pickedHome, pickedAway] = pickedScore ?? [0, 0];
    const pickedWinner = pickedScore ? (pickedHome > pickedAway ? homeTeam : awayTeam) : null;
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {header}
        <div className="p-5 space-y-6">
          <div className="flex items-start gap-4">
            <TeamColumn team={homeTeam} side="home" />
            <div className="flex-1 flex flex-col items-center justify-center pt-3 gap-1.5 min-w-0">
              <p className="text-3xl font-bold font-mono text-white tabular-nums">
                {pickedScore ? `${pickedHome} – ${pickedAway}` : "– – –"}
              </p>
              <p className="text-xs text-zinc-600 uppercase tracking-wider text-center">
                {pickedWinner ? `${pickedWinner.name} wins` : `BO${bestOf}`}
              </p>
            </div>
            <TeamColumn team={awayTeam} side="away" />
          </div>

          <div>
            <p className="text-xs text-zinc-400 mb-2">
              Select the series score ({homeTeam?.name ?? "Home"} – {awayTeam?.name ?? "Away"}).
            </p>
            <div className="flex flex-wrap gap-2">
              {legalSeriesScores(bestOf).map(([h, a]) => {
                const active = pickedScore?.[0] === h && pickedScore?.[1] === a;
                return (
                  <button
                    key={`${h}-${a}`}
                    type="button"
                    onClick={() => setPickedScore([h, a])}
                    className={`px-3.5 py-2 rounded-lg text-sm font-mono font-semibold tabular-nums border transition-colors ${
                      active
                        ? "bg-emerald-700 border-emerald-600 text-white"
                        : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                    }`}
                    aria-pressed={active}
                  >
                    {h} – {a}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 text-center">
            This event doesn&apos;t track player stats, so no replays are needed — just report the series score.
            Your opponent confirms it before it counts.
          </p>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleScoreOnlySubmit}
              disabled={submitting || !pickedScore}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? "Submitting…" : "Submit Series Result"}
            </button>
            {submitError && <p className="text-xs text-red-400">{submitError}</p>}
          </div>
        </div>
      </div>
    );
  }

  const seriesWinner = seriesOver
    ? (homeWins > awayWins ? homeTeam : awayTeam)
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {header}

      <input
        ref={fileInputRef}
        type="file"
        accept=".replay"
        className="hidden"
        onChange={onFileChange}
      />

      <div className="p-5 space-y-6">
        {/* Teams + score header */}
        <div className="flex items-start gap-4">
          <TeamColumn team={homeTeam} side="home" />
          <div className="flex-1 flex flex-col items-center justify-center pt-3 gap-1.5 min-w-0">
            <p className="text-3xl font-bold font-mono text-white tabular-nums">
              {homeWins} – {awayWins}
            </p>
            <p className="text-xs text-zinc-600 uppercase tracking-wider text-center">
              {seriesWinner
                ? `${seriesWinner.name} wins`
                : `BO${needed * 2 - 1}`}
            </p>
          </div>
          <TeamColumn team={awayTeam} side="away" />
        </div>

        {/* Game slots */}
        <div className="space-y-2">
          {slots.map((slot, i) => {
            if (slot.status === "locked") return null;
            const isWaiting   = slot.status === "waiting";
            const isDone      = slot.status === "done";
            const isAnalyzing = slot.status === "analyzing";
            const isError     = slot.status === "error";

            return (
              <div
                key={i}
                onDragOver={isWaiting ? (e) => e.preventDefault() : undefined}
                onDrop={isWaiting ? (e) => onDrop(e, i) : undefined}
                onClick={
                  isWaiting ? () => openFilePicker(i)
                  : isError  ? () => retrySlot(i)
                  : undefined
                }
                className={[
                  "flex items-center gap-3 rounded-lg px-4 py-3 border select-none transition-colors",
                  isWaiting   && "border-dashed border-indigo-500/50 bg-indigo-950/20 cursor-pointer hover:border-indigo-400/60 hover:bg-indigo-950/30",
                  isDone      && "border-zinc-700 bg-zinc-800",
                  isAnalyzing && "border-zinc-700 bg-zinc-800",
                  isError     && "border-red-700/40 bg-red-950/10 cursor-pointer",
                ].filter(Boolean).join(" ")}
              >
                <span className={`text-xs font-semibold uppercase tracking-wider w-14 shrink-0 ${
                  isWaiting ? "text-indigo-400" : "text-zinc-500"
                }`}>
                  Game {i + 1}
                </span>

                {isWaiting && (
                  <span className="text-xs text-zinc-400 flex-1">
                    Drop <span className="font-mono text-indigo-300">.replay</span> here or click to browse
                  </span>
                )}

                {isAnalyzing && (
                  <span className="flex-1 text-xs text-zinc-400 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-zinc-600 border-t-indigo-400 rounded-full animate-spin shrink-0" />
                    Analyzing…
                  </span>
                )}

                {isDone && (() => {
                  const s = slot as { status: "done"; homeWon: boolean };
                  const winner = s.homeWon ? homeTeam : awayTeam!;
                  return (
                    <>
                      <span className="flex-1 text-xs text-zinc-300">{winner.name} won</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                        s.homeWon
                          ? "bg-indigo-700/40 text-indigo-300"
                          : "bg-rose-700/40 text-rose-300"
                      }`}>
                        {s.homeWon ? "Home" : "Away"}
                      </span>
                    </>
                  );
                })()}

                {isError && (
                  <span className="flex-1 text-xs text-red-400">
                    {(slot as { message: string }).message} — click to retry
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Help note */}
        <p className="text-[11px] text-zinc-500 text-center">
          Having trouble? If a replay won&apos;t upload or a player isn&apos;t recognized, contact an admin to report the score.
        </p>

        {/* Submit (any team member, series decided) */}
        {seriesOver && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? "Submitting…" : "Submit Series Result"}
            </button>
            {submitError && <p className="text-xs text-red-400">{submitError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
