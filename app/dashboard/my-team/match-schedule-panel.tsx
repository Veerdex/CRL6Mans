"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { proposeMatchTime, acceptMatchTime, withdrawMatchTime, rejectMatchTime, checkInForMatch, processCheckInsNow } from "./schedule-actions";

export type SchedulableMatch = {
  id: string;
  opponentName: string;
  opponentId: string | null;
  opponentLogoUrl: string | null;
  roundLabel: string;
  scheduledAt: string | null;
  proposedByTeamId: string | null;
  scheduleAccepted: boolean;
  scheduleAdminRequired: boolean;
  adminPinned: boolean; // admin set a fixed time for this specific match
  adminScheduleType: "range" | "specific" | "weekly" | "custom" | null;
  adminPlayAt: string | null;
  adminDeadlineAt: string | null;
  adminRangeDays: number | null;
  isTournament: boolean;
  checkinDeadline: string | null;
  iCheckedIn: boolean;
  oppCheckedIn: boolean;
  isHome: boolean;
};

const CHECKIN_WINDOW_MS = 10 * 60 * 1000;

// Mirrors the server-side window check so we can warn before submitting. Any
// non-"specific" type (range, weekly, custom) is just the stored [playAt, deadlineAt]
// instant range (zone-independent).
function inAdminWindow(
  ms: number,
  type: "range" | "specific" | "weekly" | "custom",
  playAt: string,
  deadlineAt: string,
): boolean {
  if (type !== "specific") {
    return ms >= new Date(playAt).getTime() && ms <= new Date(deadlineAt).getTime();
  }
  return ms === new Date(playAt).getTime();
}

function formatLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatWeekRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startStr = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${startStr} - ${endStr}`;
}

// Deterministic 5-char code derived from a seed, so both teams see the same
// lobby name/password for a match. Excludes ambiguous characters (0/O/1/I/L).
function lobbyCode(seed: string): string {
  const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 5; i++) {
    h = Math.imul(h, 16777619) >>> 0;
    out += CHARS[h % CHARS.length];
  }
  return out;
}

interface Props {
  matches: SchedulableMatch[];
  teamId: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function windowNote(match: SchedulableMatch): string | null {
  const { adminScheduleType: t, adminPlayAt, adminDeadlineAt, adminRangeDays } = match;
  if (!t) return null;
  // An admin-pinned individual match is a fixed time, not a free window.
  if (match.adminPinned && match.scheduledAt) return `Admin scheduled this match for ${formatDateTime(match.scheduledAt)}.`;
  if (t !== "specific") {
    const windowText = (adminRangeDays ?? 1) <= 1
      ? `any time on ${formatLocalDate(adminPlayAt!)} (your local time)`
      : `any time ${formatWeekRange(adminPlayAt!, adminDeadlineAt!)} (your local time)`;
    return t === "custom"
      ? `Scheduled window: ${windowText}. Every match in this round needs admin approval.`
      : `Scheduled window: ${windowText}.`;
  }
  return `Admin set this match for ${formatDateTime(adminPlayAt!)}.`;
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MatchScheduleRow({
  match,
  teamId,
}: {
  match: SchedulableMatch;
  teamId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [showOutOfWindow, setShowOutOfWindow] = useState(false);
  const [dtValue, setDtValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lobbyName = lobbyCode(`${match.id}:name`);
  const lobbyPassword = lobbyCode(`${match.id}:pw`);

  const admin = match.adminScheduleType;
  // A "specific" round OR an admin-pinned individual match is a fixed, confirmed time.
  const adminLocked = admin === "specific" || match.adminPinned;
  // A window type (range, weekly, custom) means the admin only set a play window (the
  // window-start time and default play hour are recommendations, not a fixed time), so
  // teams still pick a time within it — unless this specific match was pinned by the admin.
  const isWindow = admin !== null && admin !== "specific" && !match.adminPinned;
  // A "custom" round requires admin sign-off on every match regardless of window —
  // the admin sets each match's time individually by design.
  const isCustomRound = admin === "custom";

  const weProposed = match.proposedByTeamId === teamId;
  const theyProposed = !!match.proposedByTeamId && !weProposed;
  const hasProposal = !!match.proposedByTeamId;
  // For a window with no team proposal, any stamped scheduled_at is just the window start —
  // treat the match as still needing a team-picked time.
  const needsTeamTime = isWindow && !hasProposal;
  const hasTime = !!match.scheduledAt && !needsTeamTime;
  const adminReq = match.scheduleAdminRequired;

  const confirmed     = hasTime && match.scheduleAccepted && !adminReq;
  const awaitingAdmin = hasTime && match.scheduleAccepted && adminReq;
  const awaitingTheirs = hasTime && !match.scheduleAccepted && weProposed;
  const awaitingOurs   = hasTime && !match.scheduleAccepted && theyProposed;
  const adminDefault  = adminLocked && !hasProposal && !!match.scheduledAt; // specific admin time, no team proposal yet

  function openForm() {
    setDtValue(match.scheduledAt ? toDatetimeLocalValue(match.scheduledAt) : "");
    setError(null);
    setShowOutOfWindow(false);
    setShowForm(true);
  }

  function doPropose(dt: Date) {
    startTransition(async () => {
      const res = await proposeMatchTime(match.id, dt.toISOString());
      if (res.error) { setError(res.error); return; }
      setShowForm(false);
      setShowOutOfWindow(false);
      router.refresh();
    });
  }

  function attemptPropose() {
    if (!dtValue) { setError("Pick a date and time."); return; }
    const dt = new Date(dtValue);
    if (dt.getTime() <= Date.now()) { setError("Must be in the future."); return; }
    setError(null);
    if (isCustomRound || (admin && !inAdminWindow(dt.getTime(), admin, match.adminPlayAt!, match.adminDeadlineAt!))) {
      setShowOutOfWindow(true);
      return;
    }
    doPropose(dt);
  }

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptMatchTime(match.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectMatchTime(match.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleWithdraw() {
    setError(null);
    startTransition(async () => {
      const res = await withdrawMatchTime(match.id);
      if (res.error) { setError(res.error); return; }
      setShowForm(false);
      router.refresh();
    });
  }

  const note = windowNote(match);
  const proposeLabel = adminLocked ? "Request a different time" : "Propose a different time";

  return (
    <div className="px-5 py-4 border-b border-zinc-800 last:border-0 space-y-3">

      {/* Header row: opponent + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {match.opponentLogoUrl ? (
            <img src={match.opponentLogoUrl} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
          ) : (
            <div className="w-8 h-8 rounded shrink-0 bg-zinc-800 border border-zinc-700" />
          )}
          <div>
            <p className="text-sm font-medium text-white">vs {match.opponentName}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">{match.roundLabel}</p>
          </div>
        </div>
        {(confirmed || adminDefault) && (
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            {confirmed ? "Confirmed" : "Scheduled"}
          </span>
        )}
        {awaitingAdmin && (
          <span className="text-[10px] font-bold text-purple-300 bg-purple-400/10 border border-purple-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            Awaiting admin
          </span>
        )}
        {awaitingTheirs && (
          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            Awaiting
          </span>
        )}
        {awaitingOurs && (
          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-400/10 border border-indigo-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">
            Action needed
          </span>
        )}
      </div>

      {/* Window note */}
      {note && !showForm && (
        <p className="text-[11px] text-zinc-500">{note}</p>
      )}

      {/* Current scheduled time */}
      {hasTime && !showForm && (
        <p className={`text-sm ${confirmed || adminDefault ? "text-emerald-300" : awaitingAdmin ? "text-purple-300" : "text-zinc-300"}`}>
          {confirmed ? "✅" : awaitingAdmin ? "🕓" : "📅"} {formatDateTime(match.scheduledAt!)}
          {awaitingAdmin && <span className="text-[11px] text-zinc-500"> · outside window, awaiting admin approval</span>}
        </p>
      )}

      {/* Captain actions (non-form state) */}
      {!showForm && (
        <div className="flex items-center gap-3 flex-wrap">
          {!hasTime && (
            <button
              onClick={openForm}
              disabled={isPending}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors disabled:opacity-50"
            >
              + Propose Time
            </button>
          )}

          {awaitingOurs && (
            <>
              <button
                onClick={handleAccept}
                disabled={isPending}
                className="px-3 py-1 bg-emerald-700/40 hover:bg-emerald-600/40 border border-emerald-700/50 text-emerald-300 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isPending ? "Accepting…" : adminReq ? "Confirm (sends to admin)" : "Accept"}
              </button>
              <button
                onClick={handleReject}
                disabled={isPending}
                className="px-3 py-1 bg-red-800/40 hover:bg-red-700/40 border border-red-700/50 text-red-300 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isPending ? "Rejecting…" : "Reject"}
              </button>
              <button
                onClick={openForm}
                disabled={isPending}
                className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                {proposeLabel}
              </button>
            </>
          )}

          {(awaitingTheirs || confirmed || adminDefault) && (
            <button
              onClick={openForm}
              disabled={isPending}
              className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              {adminDefault ? proposeLabel : "Change Time"}
            </button>
          )}

          {((hasTime && !confirmed && weProposed) || awaitingAdmin) && (
            <button
              onClick={handleWithdraw}
              disabled={isPending}
              className="text-xs text-red-500/70 hover:text-red-400 transition-colors"
            >
              {awaitingAdmin ? "Cancel request" : "Remove"}
            </button>
          )}
        </div>
      )}

      {/* Out-of-window confirmation popup */}
      {showOutOfWindow && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 space-y-2">
          <p className="text-xs text-amber-200 font-medium">
            {isCustomRound ? "⚠️ Requires admin approval" : "⚠️ Outside the scheduled window"}
          </p>
          <p className="text-[11px] text-amber-200/80">
            {isCustomRound
              ? "This round requires admin approval for every match. Your opponent will be asked to confirm first, then an admin reviews it."
              : <>{note} This time needs admin approval. Your opponent will be asked to confirm first, then an admin reviews it.</>}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => doPropose(new Date(dtValue))}
              disabled={isPending}
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {isPending ? "Sending…" : "Request anyway"}
            </button>
            <button
              onClick={() => setShowOutOfWindow(false)}
              disabled={isPending}
              className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              Pick another time
            </button>
          </div>
        </div>
      )}

      {/* Propose / change form */}
      {showForm && (
        <div className="space-y-2">
          {note && <p className="text-[11px] text-zinc-500">{note}</p>}
          <input
            type="datetime-local"
            value={dtValue}
            min={minDatetimeLocal()}
            onChange={(e) => { setDtValue(e.target.value); setShowOutOfWindow(false); }}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}

          {showOutOfWindow ? (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 space-y-2">
              <p className="text-xs text-amber-200 font-medium">
                {isCustomRound ? "⚠️ Requires admin approval" : "⚠️ Outside the scheduled window"}
              </p>
              <p className="text-[11px] text-amber-200/80">
                {isCustomRound
                  ? "This round requires admin approval for every match. Your opponent confirms first, then an admin reviews it."
                  : "This time needs admin approval. Your opponent confirms first, then an admin reviews it."}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => doPropose(new Date(dtValue))}
                  disabled={isPending}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {isPending ? "Sending…" : "Request anyway"}
                </button>
                <button
                  onClick={() => setShowOutOfWindow(false)}
                  disabled={isPending}
                  className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                >
                  Pick another time
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={attemptPropose}
                disabled={isPending || !dtValue}
                className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {isPending ? "Saving…" : hasTime ? "Update Time" : "Propose Time"}
              </button>
              <button
                onClick={() => { setShowForm(false); setError(null); setShowOutOfWindow(false); }}
                disabled={isPending}
                className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              {hasTime && weProposed && (
                <button
                  onClick={handleWithdraw}
                  disabled={isPending}
                  className="text-xs text-red-500/70 hover:text-red-400 transition-colors ml-auto"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && !showForm && !showOutOfWindow && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// Private match lobby — name & password (same for both teams). Away creates it.
function LobbyBox({ match }: { match: SchedulableMatch }) {
  const lobbyName = lobbyCode(`${match.id}:name`);
  const lobbyPassword = lobbyCode(`${match.id}:pw`);
  return (
    <div
      className={`border rounded-lg px-3 py-3 space-y-3 ${
        match.isHome ? "bg-blue-500/15 border-blue-500/30" : "bg-orange-500/15 border-orange-500/30"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 text-center">Private Match</p>

      <div className="flex justify-center">
        <span
          className={`text-base font-bold px-4 py-1.5 rounded-lg border ${
            match.isHome ? "bg-sky-900/40 text-sky-100 border-sky-700/50" : "bg-orange-900/40 text-orange-100 border-orange-700/50"
          }`}
        >
          {match.isHome ? "🏠 You're Home" : "✈️ You're Away"}
        </span>
      </div>

      <p className="text-sm font-bold text-zinc-100 text-center">
        {match.isHome
          ? `${match.opponentName} (Away) creates the lobby — join it with the name and password below.`
          : "Your team is Away, so you create the lobby in Rocket League with the name and password below."}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-900/60 rounded-md px-2.5 py-2 text-center">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Name</p>
          <p className="font-mono text-base font-semibold text-white tracking-widest">{lobbyName}</p>
        </div>
        <div className="bg-zinc-900/60 rounded-md px-2.5 py-2 text-center">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Password</p>
          <p className="font-mono text-base font-semibold text-white tracking-widest">{lobbyPassword}</p>
        </div>
      </div>
    </div>
  );
}

// ── Tournament check-in row ──────────────────────────────────────────────────────

function CheckInRow({ match, teamId }: { match: SchedulableMatch; teamId: string }) {
  void teamId;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const deadline = match.checkinDeadline ? new Date(match.checkinDeadline).getTime() : null;
  const opensAt = deadline !== null ? deadline - CHECKIN_WINDOW_MS : null;
  const bothCheckedIn = match.iCheckedIn && match.oppCheckedIn;

  // Tick every second while a window is active so the countdown updates and we can
  // fire the server-side DQ processing the moment the deadline passes.
  useEffect(() => {
    if (deadline === null || bothCheckedIn) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline, bothCheckedIn]);

  // When the deadline passes and we're not fully checked in, ask the server to
  // resolve it (DQ / channel). Runs once per crossing.
  useEffect(() => {
    if (deadline === null || bothCheckedIn) return;
    if (nowMs > deadline) {
      processCheckInsNow().then(() => router.refresh()).catch(() => {});
    }
  }, [nowMs, deadline, bothCheckedIn, router]);

  function handleCheckIn() {
    setError(null);
    startTransition(async () => {
      const res = await checkInForMatch(match.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function fmtCountdown(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }

  const windowOpen = opensAt !== null && nowMs >= opensAt && deadline !== null && nowMs <= deadline;
  const windowClosed = deadline !== null && nowMs > deadline;

  return (
    <div className="px-5 py-4 border-b border-zinc-800 last:border-0 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {match.opponentLogoUrl ? (
            <img src={match.opponentLogoUrl} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
          ) : (
            <div className="w-8 h-8 rounded shrink-0 bg-zinc-800 border border-zinc-700" />
          )}
          <div>
            <p className="text-sm font-medium text-white">vs {match.opponentName}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">{match.roundLabel}</p>
          </div>
        </div>
        {bothCheckedIn ? (
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Ready</span>
        ) : match.iCheckedIn ? (
          <span className="text-[10px] font-bold text-sky-300 bg-sky-400/10 border border-sky-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Checked in</span>
        ) : windowOpen ? (
          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Check in</span>
        ) : null}
      </div>

      {/* Check-in status / controls */}
      {!bothCheckedIn && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3 space-y-2">
          {deadline === null ? (
            <p className="text-xs text-zinc-400">Check-in opens once both teams are decided.</p>
          ) : !windowOpen && !windowClosed ? (
            <p className="text-xs text-zinc-400">⏰ Check-in opens at <span className="text-zinc-200 font-medium">{fmtTime(new Date(opensAt!).toISOString())}</span>. Both teams must check in within 10 minutes.</p>
          ) : windowClosed ? (
            <p className="text-xs text-amber-300">⌛ Check-in window closed. Resolving result…</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-300">
                  {match.iCheckedIn ? "✓ You're checked in — waiting for opponent." : "Check in to confirm you're ready to play."}
                </p>
                <span className="text-xs font-mono text-amber-300">{fmtCountdown(deadline - nowMs)} left</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                {match.iCheckedIn ? "" : "If you don't check in within 10 minutes, your team is DQ'd."}
              </p>
              {!match.iCheckedIn && (
                <button
                  onClick={handleCheckIn}
                  disabled={isPending}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  {isPending ? "Checking in…" : "Check In"}
                </button>
              )}
              {error && <p className="text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>
      )}

      {/* Lobby only after both teams check in */}
      {bothCheckedIn && <LobbyBox match={match} />}
    </div>
  );
}

export function MatchSchedulePanel({ matches, teamId }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Match Schedule</h2>
      </div>
      {matches.map((m) =>
        m.isTournament
          ? <CheckInRow key={m.id} match={m} teamId={teamId} />
          : <MatchScheduleRow key={m.id} match={m} teamId={teamId} />
      )}
    </div>
  );
}
