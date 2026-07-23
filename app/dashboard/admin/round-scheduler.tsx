"use client";

import { useState, useTransition, useEffect } from "react";
import { setRoundSchedule, deleteRoundSchedule, pinMatchTime, clearMatchTime, startFirstRound } from "./schedule-actions";
import { stageName, type ScheduleType, type RoundScheduleRow } from "./schedule-utils";
import { LocalTime } from "../local-time";

export type RoundMatchInfo = {
  id: string;
  matchNumber: number;
  groupNum: number | null;
  homeName: string;
  awayName: string;
  scheduledAt: string | null;
  adminScheduled: boolean;
  hasProposal: boolean;
  hasChannel: boolean;
};

// The admin's own IANA zone — times they enter are read in it. Resolved at call time
// (always in the browser) so it reflects the actual viewer, not the server.
function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// Stored instant → a `datetime-local`/`date` input value in the viewer's local zone.
function isoToLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function localTimeShort(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// The viewer's timezone abbreviation (e.g. "CDT"), resolved after mount to avoid a
// hydration mismatch. Shown next to time inputs so the admin knows the zone.
function ZoneLabel() {
  const [abbr, setAbbr] = useState<string>("");
  useEffect(() => {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
    setAbbr(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  }, []);
  return <span className="text-[10px] text-zinc-600">{abbr || "local"}</span>;
}

const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  range: "Range",
  specific: "Specific",
  weekly: "Weekly",
  custom: "Custom",
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function scheduleTypeLabel(s: RoundScheduleRow): string {
  if (s.scheduleType === "range") return `Range (${s.rangeDays ?? 1}d)`;
  if (s.scheduleType === "weekly") return "Weekly (7d)";
  if (s.scheduleType === "custom") return `Custom (${s.rangeDays ?? 1}d)`;
  return SCHEDULE_TYPE_LABELS[s.scheduleType];
}

function playAtToInputStr(playAt: string, schedType: ScheduleType): string {
  const d = new Date(playAt); // local-zone fields
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (schedType === "specific") return `${date}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return date;
}


export type ScheduleSection = {
  stage: string;      // canonical stage name
  rounds: number[];   // sorted round numbers
  maxRound: number;
};

type Props = {
  tournamentId: string | null;
  sections: ScheduleSection[];
  schedules: RoundScheduleRow[];
  lockedRounds: string[];  // "stage:round" strings
  matchesByRound: Record<string, RoundMatchInfo[]>;  // keyed "canonStage:round"
  playHour: number;
  matchDeadlineDay: number;
  round1ManualStartPending: boolean;
};

function namedRound(fromFinal: number, round: number, prefix = ""): string {
  if (fromFinal === 0) return `${prefix}Final`;
  if (fromFinal === 1) return `${prefix}Semifinals`;
  if (fromFinal === 2) return `${prefix}Quarterfinals`;
  return `${prefix}Round ${round}`;
}

// Swiss rounds are labelled by the W–L records of teams still playing that round,
// e.g. R1 "0-0", R2 "1-0  0-1", R3 "2-0  1-1  0-2". Teams that hit the advance/
// eliminate threshold leave, so those records drop off in later rounds.
function swissRecordLabel(round: number, maxRound: number): string {
  const threshold = Math.ceil((maxRound + 1) / 2); // advance wins = eliminate losses
  const played = round - 1;
  const recs: string[] = [];
  for (let w = played; w >= 0; w--) {
    const l = played - w;
    if (w < threshold && l < threshold) recs.push(`${w}-${l}`);
  }
  return recs.length ? recs.join("  ") : `Round ${round}`;
}

function getRoundLabel(stage: string, round: number, maxRound: number): string {
  const fromFinal = maxRound - round;
  if (stage === "swiss") return swissRecordLabel(round, maxRound);
  if (stage === "single_elimination") return namedRound(fromFinal, round);
  if (stage === "de_grand_final" || stage.endsWith("_gf")) return "Grand Final";
  if (stage.endsWith("_sf")) return "Semifinals";
  if (stage === "de_winners") return namedRound(fromFinal, round, "WB ");
  if (stage === "de_losers") return namedRound(fromFinal, round, "LB ");
  // Truncated qualifier brackets never reach a final — keep plain round numbers
  if (stage === "se_qualifier") return `Qualifier Round ${round}`;
  if (stage === "deq_winners") return `Qualifier WB Round ${round}`;
  if (stage === "deq_losers") return `Qualifier LB Round ${round}`;
  if (stage.endsWith("_ub")) return `UB Round ${round}`;
  if (stage.endsWith("_lb")) return `LB Round ${round}`;
  return `Round ${round}`;
}

function windowLenMs(type: ScheduleType, rangeDays: number | null): number {
  if (type !== "specific") return (rangeDays ?? 1) * 86_400_000;
  return 0; // specific
}

// The play time a "follow" would produce — must mirror setRoundSchedule: start when
// the previous round's window ends, anchored to 12:00 AM (local zone) for a window type.
function inferredPlayAt(prevPlayAt: string, prevType: ScheduleType, prevRangeDays: number | null, nextType: ScheduleType): Date {
  const ms = new Date(prevPlayAt).getTime() + windowLenMs(prevType, prevRangeDays);
  if (nextType !== "specific") {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0); // local midnight
    return d;
  }
  return new Date(ms);
}

// Weekday (0=Sunday) a weekly round must start on, given the league's match deadline day.
function requiredWeeklyWeekday(matchDeadlineDay: number): number {
  return (matchDeadlineDay + 1) % 7;
}

function weekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

// Nearest date (browser-local) on/after `from` that falls on `targetWeekday`, as YYYY-MM-DD.
function nearestWeekdayOnOrAfter(from: Date, targetWeekday: number): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((targetWeekday - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ── Per-match scheduling (expanded round) ───────────────────────────────────────

function MatchPinRow({
  match,
  minStr,
  maxStr,
  isCustom,
}: {
  match: RoundMatchInfo;
  minStr: string;
  maxStr: string;
  isCustom: boolean;
}) {
  const [val, setVal] = useState(match.scheduledAt && match.adminScheduled ? isoToLocalDateTimeInput(match.scheduledAt) : "");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const label = match.groupNum != null
    ? `Group ${match.groupNum} · M${match.matchNumber}`
    : `Match ${match.matchNumber}`;

  function pin(dt: string) {
    if (!dt) return;
    setErr(null);
    startTransition(async () => {
      const res = await pinMatchTime(match.id, dt, browserTz());
      if (!res.ok) setErr(res.error ?? "Failed.");
    });
  }
  function clear() {
    setErr(null);
    setVal("");
    startTransition(async () => {
      const res = await clearMatchTime(match.id);
      if (!res.ok) setErr(res.error ?? "Failed.");
    });
  }

  const inputBase =
    "text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-4 border-b border-zinc-800/40 last:border-0">
      <span className="text-xs font-medium text-zinc-400 w-28 shrink-0">{label}</span>
      <span className="text-xs text-zinc-500 w-44 shrink-0 truncate">{match.homeName} vs {match.awayName}</span>

      {match.hasChannel ? (
        <span className="text-[11px] text-zinc-500">In progress — locked</span>
      ) : (
        <>
          <input
            type="datetime-local"
            value={val}
            min={minStr}
            max={maxStr}
            onChange={(e) => { setVal(e.target.value); pin(e.target.value); }}
            className={inputBase}
            disabled={pending}
          />
          <ZoneLabel />
          {match.adminScheduled ? (
            <span className="text-[10px] text-emerald-400">Pinned</span>
          ) : match.hasProposal ? (
            <span className="text-[10px] text-amber-400">Teams negotiating</span>
          ) : (
            <span className="text-[10px] text-zinc-600">{isCustom ? "Undecided — admin must set" : "Undecided — teams negotiate"}</span>
          )}
          {match.adminScheduled && !pending && (
            <button onClick={clear} className="text-[11px] text-zinc-500 hover:text-zinc-300 underline">Clear</button>
          )}
          {pending && <span className="text-[11px] text-zinc-500">…</span>}
        </>
      )}
      {err && <p className="w-full text-[11px] text-red-400 pl-28">{err}</p>}
    </div>
  );
}

function MatchPinList({
  matches,
  schedule,
}: {
  matches: RoundMatchInfo[];
  schedule: RoundScheduleRow;
}) {
  const minStr = isoToLocalDateTimeInput(schedule.playAt);
  const maxStr = isoToLocalDateTimeInput(schedule.deadlineAt);
  const isCustom = schedule.scheduleType === "custom";
  return (
    <div className="mt-1 ml-2 border-l-2 border-zinc-800 pl-2">
      <p className="text-[10px] text-zinc-600 pl-2 py-1">
        {isCustom
          ? `Custom round — every match must be scheduled individually within the window (${localTimeShort(schedule.playAt)} – ${localTimeShort(schedule.deadlineAt)}, your local time).`
          : `Times must fall within the window (${localTimeShort(schedule.playAt)} – ${localTimeShort(schedule.deadlineAt)}, your local time). Undecided matches let the teams pick.`}
      </p>
      {matches.map((m) => (
        <MatchPinRow key={m.id} match={m} minStr={minStr} maxStr={maxStr} isCustom={isCustom} />
      ))}
    </div>
  );
}

// ── Round row ──────────────────────────────────────────────────────────────────

function RoundRow({
  tournamentId,
  stage,
  round,
  maxRound,
  schedule,
  isLocked,
  prevSchedule,
  playHour,
  matchDeadlineDay,
  matches,
  isSeasonOpener,
  manualStartPending,
}: {
  tournamentId: string | null;
  stage: string;
  round: number;
  maxRound: number;
  schedule: RoundScheduleRow | undefined;
  isLocked: boolean;
  prevSchedule: RoundScheduleRow | undefined;
  playHour: number;
  matchDeadlineDay: number;
  matches?: RoundMatchInfo[];
  isSeasonOpener: boolean;
  manualStartPending: boolean;
}) {
  const label = getRoundLabel(stage, round, maxRound);
  const requiredWeekday = requiredWeeklyWeekday(matchDeadlineDay);

  const [type, setType] = useState<ScheduleType>(schedule?.scheduleType ?? "range");
  const [rangeDays, setRangeDays] = useState<number>(schedule?.rangeDays ?? 1);
  const [expanded, setExpanded] = useState(false);

  // Per-match scheduling is available once the round has a window set, the type is a
  // window (not a single fixed time), and more than one match exists for the round.
  // A "custom" round always requires per-match scheduling — the admin sets every
  // match's time individually, so it's available even for a single-match round.
  const isCustomType = schedule?.scheduleType === "custom";
  const canExpand = !!schedule && schedule.scheduleType !== "specific" && (matches?.length ?? 0) > (isCustomType ? 0 : 1);

  const canChain = round > 1 && !!prevSchedule && prevSchedule.scheduleType !== "specific" && type !== "specific";

  // Restore Follow state: if the saved play_at matches what the inferred value would be, treat it as chained.
  const initialChain = canChain && !!schedule && !!prevSchedule
    ? Math.abs(
        new Date(schedule.playAt).getTime() -
        inferredPlayAt(prevSchedule.playAt, prevSchedule.scheduleType, prevSchedule.rangeDays, schedule.scheduleType).getTime()
      ) < 60_000
    : false;

  const [chain, setChain] = useState(initialChain);
  const [dateStr, setDateStr] = useState(
    schedule && !initialChain ? playAtToInputStr(schedule.playAt, schedule.scheduleType) : ""
  );
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [confirmingStart, setConfirmingStart] = useState(false);

  // Standalone seasons only — tournament round 1 is gated by team check-in instead,
  // so the manual-start flag never applies there.
  const showStartButton = !tournamentId && isSeasonOpener && manualStartPending && !!schedule;

  function doStart() {
    setErr(null);
    startTransition(async () => {
      const res = await startFirstRound();
      if (!res.ok) setErr(res.error ?? "Failed.");
      setConfirmingStart(false);
    });
  }

  const inferred = canChain && chain
    ? inferredPlayAt(prevSchedule!.playAt, prevSchedule!.scheduleType, prevSchedule!.rangeDays, type)
    : null;

  function flashSaved() {
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  }

  function doSave(opts: { useChain: boolean; date: string; schedType: ScheduleType; days: number }) {
    setErr(null);
    startTransition(async () => {
      const res = await setRoundSchedule({
        tournamentId,
        stage,
        round,
        scheduleType: opts.schedType,
        rangeDays: opts.schedType === "range" || opts.schedType === "custom" ? opts.days : opts.schedType === "weekly" ? 7 : null,
        dateStr: opts.useChain ? "" : opts.date,
        timeZone: browserTz(),
      });
      if (res.ok) flashSaved();
      else {
        setErr(res.error ?? "Failed.");
        if (opts.useChain) setChain(false);
      }
    });
  }

  // Weekly rounds must start the day after the league's match deadline day (e.g.
  // deadline Tuesday → weekly starts Wednesday). Returns an error message, or null if OK.
  function weeklyDateError(val: string): string | null {
    if (weekdayOfDateStr(val) === requiredWeekday) return null;
    return `Weekly rounds must start on ${WEEKDAY_NAMES[requiredWeekday]} — the day after the match deadline day (${WEEKDAY_NAMES[matchDeadlineDay]}).`;
  }

  function handleTypeChange(next: ScheduleType) {
    setType(next);
    setErr(null);
    // Switching to/from specific changes the input format; reset so user re-enters
    const formatChanged = (type === "specific") !== (next === "specific");
    if (formatChanged) setDateStr("");
    if (next === "specific" && chain) {
      setChain(false);
      startTransition(async () => {
        await deleteRoundSchedule({ tournamentId, stage, round, timeZone: browserTz() });
      });
      return;
    }
    if (chain) doSave({ useChain: true, date: "", schedType: next, days: rangeDays });
    else if (dateStr && !formatChanged) {
      if (next === "weekly") {
        const werr = weeklyDateError(dateStr);
        if (werr) { setErr(werr); return; }
      }
      doSave({ useChain: false, date: dateStr, schedType: next, days: rangeDays });
    }
  }

  function handleToggleChain() {
    if (chain) {
      setChain(false);
      setDateStr("");
      startTransition(async () => {
        const res = await deleteRoundSchedule({ tournamentId, stage, round });
        if (!res.ok) setErr(res.error ?? "Failed.");
      });
    } else {
      setChain(true);
      doSave({ useChain: true, date: "", schedType: type, days: rangeDays });
    }
  }

  function handleDateChange(val: string) {
    setDateStr(val);
    setErr(null);
    if (!val) return;
    if (type === "weekly") {
      const werr = weeklyDateError(val);
      if (werr) { setErr(werr); return; }
    }
    doSave({ useChain: false, date: val, schedType: type, days: rangeDays });
  }

  function handleRangeDaysChange(days: number) {
    setRangeDays(days);
    setErr(null);
    if (chain) doSave({ useChain: true, date: "", schedType: type, days });
    else if (dateStr) doSave({ useChain: false, date: dateStr, schedType: type, days });
  }

  function handleClear() {
    setErr(null);
    setChain(false);
    setDateStr("");
    startTransition(async () => {
      const res = await deleteRoundSchedule({ tournamentId, stage, round });
      if (!res.ok) setErr(res.error ?? "Failed.");
    });
  }

  const inputBase =
    "text-sm bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500";

  // Locked read-only row
  if (isLocked) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 border-b border-zinc-800/60 last:border-0">
        <span className="text-sm font-medium text-zinc-300 w-36 shrink-0">{label}</span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500 shrink-0">
            <path d="M17 11V7A5 5 0 0 0 7 7v4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1Zm-2 0H9V7a3 3 0 1 1 6 0v4Z" />
          </svg>
          Locked
        </span>
        {schedule && (
          <span className="text-xs text-zinc-400">
            {scheduleTypeLabel(schedule)} ·{" "}
            <LocalTime iso={schedule.playAt} />
            {schedule.scheduleType !== "specific" && (
              <>{" → deadline "}<LocalTime iso={schedule.deadlineAt} /></>
            )}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="py-2.5 border-b border-zinc-800/60 last:border-0 space-y-2">
      {/* Current schedule display */}
      {schedule && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium text-zinc-300 w-36 shrink-0">{label}</span>
          <span className="text-xs text-zinc-500">
            {scheduleTypeLabel(schedule)} ·{" "}
            <LocalTime iso={schedule.playAt} className="text-zinc-400" />
            {schedule.scheduleType !== "specific" && (
              <>{" → deadline "}<LocalTime iso={schedule.deadlineAt} className="text-zinc-400" /></>
            )}
          </span>
          {showStartButton && (
            <span className="text-[10px] text-emerald-400">Awaiting manual start — won&apos;t go live until you press Start Round</span>
          )}
        </div>
      )}

      {!schedule && (
        <span className="text-sm font-medium text-zinc-300 w-36 inline-block">{label}</span>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Type selector */}
        <select
          value={type}
          onChange={(e) => { e.stopPropagation(); handleTypeChange(e.target.value as ScheduleType); }}
          className={`${inputBase} pr-7 appearance-none`}
          disabled={pending}
        >
          <option value="range">Range</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Custom</option>
          <option value="specific">Specific</option>
        </select>

        {/* Follow toggle */}
        {canChain && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={chain}
              onClick={(e) => { e.stopPropagation(); handleToggleChain(); }}
              disabled={pending}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                chain ? "bg-indigo-600 border-indigo-600" : "bg-zinc-700 border-zinc-700"
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${chain ? "translate-x-4" : "translate-x-0"}`} />
            </button>
            <span className="text-xs text-zinc-400">
              Follow Round {round - 1}
              {inferred && (
                <span className="text-zinc-500 ml-1">
                  → {inferred.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                  {inferred.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                </span>
              )}
            </span>
          </div>
        )}

        {/* Date input — hidden when follow is on (follow infers the start date) */}
        {!chain && (
          <div className="flex items-center gap-1.5">
            <input
              type={type === "specific" ? "datetime-local" : "date"}
              value={dateStr}
              min={type === "weekly" ? nearestWeekdayOnOrAfter(new Date(), requiredWeekday) : undefined}
              step={type === "weekly" ? 7 : undefined}
              onChange={(e) => handleDateChange(e.target.value)}
              className={inputBase}
              disabled={pending}
            />
            {(type === "range" || type === "custom") && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                {playHour % 12 || 12}{playHour >= 12 ? "PM" : "AM"} <ZoneLabel />
              </span>
            )}
            {type === "weekly" && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                {WEEKDAY_NAMES[requiredWeekday]}s only, {playHour % 12 || 12}{playHour >= 12 ? "PM" : "AM"} <ZoneLabel />
              </span>
            )}
            {type === "specific" && <ZoneLabel />}
          </div>
        )}

        {/* Range/custom day-count — editable regardless of follow, since follow only infers the start date */}
        {(type === "range" || type === "custom") && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-500">for</span>
            <input
              type="number"
              min={1}
              value={rangeDays}
              onChange={(e) => handleRangeDaysChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className={`${inputBase} w-16`}
              disabled={pending}
            />
            <span className="text-xs text-zinc-500">day{rangeDays === 1 ? "" : "s"}</span>
          </div>
        )}
        {type === "weekly" && (
          <span className="text-xs text-zinc-500">for 7 days</span>
        )}

        {/* Status indicators */}
        {pending && <span className="text-xs text-zinc-500">Saving…</span>}
        {savedOk && !pending && <span className="text-xs text-emerald-400">Saved</span>}

        {/* Clear */}
        {schedule && !pending && (
          <button
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-300 font-medium transition-colors"
          >
            Clear
          </button>
        )}

        {/* Manual start — season opener only, holds off auto-open until clicked */}
        {showStartButton && !pending && (
          confirmingStart ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400">Start round now?</span>
              <button
                onClick={(e) => { e.stopPropagation(); doStart(); }}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmingStart(false); }}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-medium transition-colors"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmingStart(true); }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
            >
              Start Round
            </button>
          )
        )}

        {/* Expand — per-match scheduling */}
        {canExpand && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((e) => !e); }}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-indigo-300 hover:text-indigo-200 font-medium transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
            {expanded ? "Hide matches" : `Set matches (${matches!.length})`}
          </button>
        )}
      </div>

      {canExpand && expanded && <MatchPinList matches={matches!} schedule={schedule!} />}

      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

// ── Scheduling group ─────────────────────────────────────────────────────────────
// A group is one collapsible box. Most stages are their own group, but all hybrid
// bracket stages (UB/LB/SF/GF) collapse into a single "Hybrid" group.

type GroupRow = { stage: string; round: number; maxRound: number };
type SubSection = { stage: string; name: string; rows: GroupRow[] };
type SchedulingGroup = { key: string; name: string; subs: SubSection[] };

function stageGroupInfo(stage: string): { key: string; name: string } {
  if (stage.startsWith("hybrid8_")) return { key: "hybrid8", name: "Hybrid" };
  if (stage.startsWith("hybrid_")) return { key: "hybrid", name: "Hybrid" };
  if (stage === "de_winners" || stage === "de_losers" || stage === "de_grand_final")
    return { key: "de", name: "Double Elimination" };
  if (stage === "deq_winners" || stage === "deq_losers")
    return { key: "deq", name: "DE Qualifier" };
  return { key: stage, name: stageName(stage) };
}

function CollapsibleSub({
  sub,
  ...rowProps
}: {
  sub: SubSection;
  scheduleByKey: Map<string, RoundScheduleRow>;
  lockedSet: Set<string>;
  tournamentId: string | null;
  matchesByRound: Record<string, RoundMatchInfo[]>;
  playHour: number;
  matchDeadlineDay: number;
  firstStage: string | undefined;
  round1ManualStartPending: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-zinc-800/80 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{sub.name}</h4>
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-zinc-500 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-1">
          <SubSectionRows sub={sub} {...rowProps} />
        </div>
      )}
    </div>
  );
}

function SubSectionRows({
  sub,
  scheduleByKey,
  lockedSet,
  tournamentId,
  matchesByRound,
  playHour,
  matchDeadlineDay,
  firstStage,
  round1ManualStartPending,
}: {
  sub: SubSection;
  scheduleByKey: Map<string, RoundScheduleRow>;
  lockedSet: Set<string>;
  tournamentId: string | null;
  matchesByRound: Record<string, RoundMatchInfo[]>;
  playHour: number;
  matchDeadlineDay: number;
  firstStage: string | undefined;
  round1ManualStartPending: boolean;
}) {
  return (
    <div>
      {sub.rows.map(({ stage, round, maxRound }) => {
        const key = `${stage}:${round}`;
        const schedule = scheduleByKey.get(key);
        const prevSchedule = round > 1 ? scheduleByKey.get(`${stage}:${round - 1}`) : undefined;
        const isLocked = lockedSet.has(key);

        return (
          <RoundRow
            key={`${key}:${schedule ? "set" : "unset"}`}
            tournamentId={tournamentId}
            stage={stage}
            round={round}
            maxRound={maxRound}
            schedule={schedule}
            isLocked={isLocked}
            prevSchedule={prevSchedule}
            matches={matchesByRound[key]}
            playHour={playHour}
            matchDeadlineDay={matchDeadlineDay}
            isSeasonOpener={stage === firstStage && round === 1}
            manualStartPending={round1ManualStartPending}
          />
        );
      })}
    </div>
  );
}

function GroupSection({
  group,
  scheduleByKey,
  lockedSet,
  tournamentId,
  matchesByRound,
  playHour,
  matchDeadlineDay,
  firstStage,
  round1ManualStartPending,
}: {
  group: SchedulingGroup;
  scheduleByKey: Map<string, RoundScheduleRow>;
  lockedSet: Set<string>;
  tournamentId: string | null;
  matchesByRound: Record<string, RoundMatchInfo[]>;
  playHour: number;
  matchDeadlineDay: number;
  firstStage: string | undefined;
  round1ManualStartPending: boolean;
}) {
  const [open, setOpen] = useState(true);
  const hasSubHeaders = group.subs.length > 1;
  const totalRows = group.subs.reduce((n, s) => n + s.rows.length, 0);

  const subProps = { scheduleByKey, lockedSet, tournamentId, matchesByRound, playHour, matchDeadlineDay, firstStage, round1ManualStartPending };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">{group.name}</h3>
          {totalRows === 0 && (
            <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">pending</span>
          )}
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-zinc-500 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {totalRows === 0 ? (
            <p className="text-xs text-zinc-500 py-2">Rounds will appear here once this stage&apos;s bracket is generated.</p>
          ) : hasSubHeaders ? (
            <div className="space-y-2">
              {group.subs.map((sub) => (
                <CollapsibleSub key={sub.stage} sub={sub} {...subProps} />
              ))}
            </div>
          ) : (
            <SubSectionRows sub={group.subs[0]} {...subProps} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RoundScheduler({
  tournamentId,
  sections,
  schedules,
  lockedRounds,
  matchesByRound,
  playHour,
  matchDeadlineDay,
  round1ManualStartPending,
}: Props) {
  // Inputs derive their initial values from browser-local dates, which differ from the
  // server's zone — render after mount so SSR and the first client paint never mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const scheduleByKey = new Map(
    schedules.map((s) => [`${s.stage}:${s.round}`, s]),
  );
  const lockedSet = new Set(lockedRounds);

  if (!sections.length) {
    return (
      <p className="text-sm text-zinc-500">No format configured. Set a season format to enable scheduling.</p>
    );
  }
  if (!mounted) {
    return <p className="text-sm text-zinc-500">Loading scheduler…</p>;
  }

  // sections arrive pre-sorted by STAGE_ORDER, so the first entry is the season's
  // opening stage — round 1 there is the one gated by round1ManualStartPending.
  const firstStage = sections[0]?.stage;

  // Collapse stages into display groups (e.g. all DE stages → one "Double Elimination"
  // box with Winners/Losers/Grand Final sub-sections). sections arrive pre-sorted by
  // STAGE_ORDER, so sub-sections and their rows stay in chronological order.
  const groups: SchedulingGroup[] = [];
  const groupIndex = new Map<string, number>();
  for (const section of sections) {
    const { key, name } = stageGroupInfo(section.stage);
    let idx = groupIndex.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(key, idx);
      groups.push({ key, name, subs: [] });
    }
    groups[idx].subs.push({
      stage: section.stage,
      name: stageName(section.stage),
      rows: section.rounds.map((round) => ({ stage: section.stage, round, maxRound: section.maxRound })),
    });
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <GroupSection
          key={group.key}
          group={group}
          scheduleByKey={scheduleByKey}
          lockedSet={lockedSet}
          tournamentId={tournamentId}
          matchesByRound={matchesByRound}
          playHour={playHour}
          matchDeadlineDay={matchDeadlineDay}
          firstStage={firstStage}
          round1ManualStartPending={round1ManualStartPending}
        />
      ))}
    </div>
  );
}
