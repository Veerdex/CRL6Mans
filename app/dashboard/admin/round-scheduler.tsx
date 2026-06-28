"use client";

import { useState, useTransition, useEffect } from "react";
import { setRoundSchedule, deleteRoundSchedule, pinMatchTime, clearMatchTime } from "./schedule-actions";
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
  weekly: "Weekly",
  daily: "Daily",
  specific: "Specific",
};

function playAtToInputStr(playAt: string, schedType: ScheduleType): string {
  const d = new Date(playAt); // local-zone fields
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (schedType === "specific") return `${date}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return date;
}

// Weekly start-date options (the day after the deadline day), computed in the admin's
// local zone so the saved date is read back in the same zone.
function getWeekdayOptions(playDay: number, currentValue?: string): { label: string; value: string }[] {
  const today = new Date();
  const lastPlayDay = new Date(today);
  lastPlayDay.setDate(today.getDate() - ((today.getDay() - playDay + 7) % 7));
  lastPlayDay.setHours(0, 0, 0, 0);

  const results: { label: string; value: string }[] = [];
  for (let i = -4; i <= 20; i++) {
    const d = new Date(lastPlayDay);
    d.setDate(lastPlayDay.getDate() + i * 7);
    const value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const label = d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    results.push({ value, label });
  }
  if (currentValue && !results.find((r) => r.value === currentValue)) {
    const [y, m, dd] = currentValue.split("-").map(Number);
    const d = new Date(y, m - 1, dd);
    const label = d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    results.unshift({ value: currentValue, label });
  }
  return results;
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
  deadlineDay: number;
  isDE: boolean;
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

function windowLenMs(type: ScheduleType): number {
  if (type === "daily") return 86_400_000;
  if (type === "weekly") return 7 * 86_400_000;
  return 0; // specific
}

// The play time a "follow" would produce — must mirror setRoundSchedule: start when
// the previous round's window ends, anchored to 12:00 AM (local zone) for daily/weekly.
function inferredPlayAt(prevPlayAt: string, prevType: ScheduleType, nextType: ScheduleType): Date {
  const ms = new Date(prevPlayAt).getTime() + windowLenMs(prevType);
  if (nextType === "daily" || nextType === "weekly") {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0); // local midnight
    return d;
  }
  return new Date(ms);
}

// ── Per-match scheduling (expanded round) ───────────────────────────────────────

function MatchPinRow({
  match,
  minStr,
  maxStr,
}: {
  match: RoundMatchInfo;
  minStr: string;
  maxStr: string;
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
            <span className="text-[10px] text-zinc-600">Undecided — teams negotiate</span>
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
  return (
    <div className="mt-1 ml-2 border-l-2 border-zinc-800 pl-2">
      <p className="text-[10px] text-zinc-600 pl-2 py-1">
        Times must fall within the window ({localTimeShort(schedule.playAt)} – {localTimeShort(schedule.deadlineAt)}, your local time). Undecided matches let the teams pick.
      </p>
      {matches.map((m) => (
        <MatchPinRow key={m.id} match={m} minStr={minStr} maxStr={maxStr} />
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
  deadlineDay,
  isDeAutoSynced,
  matches,
}: {
  tournamentId: string | null;
  stage: string;
  round: number;
  maxRound: number;
  schedule: RoundScheduleRow | undefined;
  isLocked: boolean;
  prevSchedule: RoundScheduleRow | undefined;
  playHour: number;
  deadlineDay: number;
  isDeAutoSynced?: boolean;
  matches?: RoundMatchInfo[];
}) {
  const label = getRoundLabel(stage, round, maxRound);

  const [type, setType] = useState<ScheduleType>(schedule?.scheduleType ?? "weekly");
  const [expanded, setExpanded] = useState(false);

  // Per-match scheduling is available once the round has a window set, the type is a
  // window (not a single fixed time), and more than one match exists for the round.
  const canExpand = !!schedule && schedule.scheduleType !== "specific" && (matches?.length ?? 0) > 1;

  const canChain = round > 1 && !!prevSchedule && prevSchedule.scheduleType !== "specific" && type !== "specific";

  // Restore Follow state: if the saved play_at matches what the inferred value would be, treat it as chained.
  const initialChain = canChain && !!schedule && !!prevSchedule
    ? Math.abs(
        new Date(schedule.playAt).getTime() -
        inferredPlayAt(prevSchedule.playAt, prevSchedule.scheduleType, schedule.scheduleType).getTime()
      ) < 60_000
    : false;

  const [chain, setChain] = useState(initialChain);
  const [dateStr, setDateStr] = useState(
    schedule && !initialChain ? playAtToInputStr(schedule.playAt, schedule.scheduleType) : ""
  );
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const inferred = canChain && chain ? inferredPlayAt(prevSchedule!.playAt, prevSchedule!.scheduleType, type) : null;

  function flashSaved() {
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  }

  function doSave(opts: { useChain: boolean; date: string; schedType: ScheduleType }) {
    setErr(null);
    startTransition(async () => {
      const res = await setRoundSchedule({
        tournamentId,
        stage,
        round,
        scheduleType: opts.schedType,
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
    if (chain) doSave({ useChain: true, date: "", schedType: next });
    else if (dateStr && !formatChanged) doSave({ useChain: false, date: dateStr, schedType: next });
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
      doSave({ useChain: true, date: "", schedType: type });
    }
  }

  function handleDateChange(val: string) {
    setDateStr(val);
    setErr(null);
    if (!val) return;
    doSave({ useChain: false, date: val, schedType: type });
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
            {SCHEDULE_TYPE_LABELS[schedule.scheduleType]} ·{" "}
            <LocalTime iso={schedule.playAt} />
            {schedule.scheduleType !== "specific" && (
              <>{" → deadline "}<LocalTime iso={schedule.deadlineAt} /></>
            )}
          </span>
        )}
        {isDeAutoSynced && (
          <span className="text-[10px] text-indigo-400 bg-indigo-950/40 px-1.5 py-0.5 rounded">auto-synced</span>
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
            {SCHEDULE_TYPE_LABELS[schedule.scheduleType]} ·{" "}
            <LocalTime iso={schedule.playAt} className="text-zinc-400" />
            {schedule.scheduleType !== "specific" && (
              <>{" → deadline "}<LocalTime iso={schedule.deadlineAt} className="text-zinc-400" /></>
            )}
            {isDeAutoSynced && (
              <span className="ml-2 text-[10px] text-indigo-400 bg-indigo-950/40 px-1.5 py-0.5 rounded">auto-synced</span>
            )}
          </span>
        </div>
      )}

      {!schedule && (
        <span className="text-sm font-medium text-zinc-300 w-36 inline-block">{label}</span>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Type selector */}
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as ScheduleType)}
          className={`${inputBase} pr-7 appearance-none`}
          disabled={pending}
        >
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
          <option value="specific">Specific</option>
        </select>

        {/* Follow toggle */}
        {canChain && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={chain}
              onClick={handleToggleChain}
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

        {/* Date input — hidden when follow is on */}
        {!chain && (
          <div className="flex items-center gap-1.5">
            {type === "weekly" ? (
              <select
                value={dateStr}
                onChange={(e) => handleDateChange(e.target.value)}
                className={`${inputBase} pr-7 appearance-none`}
                disabled={pending}
              >
                <option value="">Pick a {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][(deadlineDay + 1) % 7]}…</option>
                {getWeekdayOptions((deadlineDay + 1) % 7, dateStr || undefined).map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            ) : (
              <input
                type={type === "specific" ? "datetime-local" : "date"}
                value={dateStr}
                onChange={(e) => handleDateChange(e.target.value)}
                className={inputBase}
                disabled={pending}
              />
            )}
            {(type === "weekly" || type === "daily") && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                {playHour % 12 || 12}{playHour >= 12 ? "PM" : "AM"} <ZoneLabel />
              </span>
            )}
            {type === "specific" && <ZoneLabel />}
          </div>
        )}

        {/* Status indicators */}
        {pending && <span className="text-xs text-zinc-500">Saving…</span>}
        {savedOk && !pending && <span className="text-xs text-emerald-400">Saved</span>}

        {/* Clear */}
        {schedule && !pending && (
          <button
            onClick={handleClear}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-300 font-medium transition-colors"
          >
            Clear
          </button>
        )}

        {/* Expand — per-match scheduling */}
        {canExpand && (
          <button
            onClick={() => setExpanded((e) => !e)}
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

// Read-only LB round whose time is driven entirely by the corresponding WB round.
function AutoSyncedRow({
  stage, round, maxRound, schedule, wbRound, wbMaxRound,
}: {
  stage: string;
  round: number;
  maxRound: number;
  schedule: RoundScheduleRow | undefined;
  wbRound: number;
  wbMaxRound?: number;
}) {
  const label = getRoundLabel(stage, round, maxRound);
  const wbName = namedRound(wbMaxRound != null ? wbMaxRound - wbRound : 99, wbRound);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-sm font-medium text-zinc-300 w-36 shrink-0">{label}</span>
      {schedule ? (
        <span className="text-xs text-zinc-400">
          <LocalTime iso={schedule.playAt} className="text-zinc-400" />
          {schedule.scheduleType !== "specific" && (
            <>{" → deadline "}<LocalTime iso={schedule.deadlineAt} className="text-zinc-400" /></>
          )}
          <span className="ml-2 text-[10px] text-indigo-400 bg-indigo-950/40 px-1.5 py-0.5 rounded">
            synced from WB {wbName}
          </span>
        </span>
      ) : (
        <span className="text-xs text-zinc-500">Set Winners Bracket {wbName} to schedule this.</span>
      )}
    </div>
  );
}

function CollapsibleSub({
  sub,
  isDE,
  ...rowProps
}: {
  sub: SubSection;
  scheduleByKey: Map<string, RoundScheduleRow>;
  lockedSet: Set<string>;
  tournamentId: string | null;
  matchesByRound: Record<string, RoundMatchInfo[]>;
  playHour: number;
  deadlineDay: number;
  isDE: boolean;
  wbMaxRound?: number;
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
          {isDE && sub.stage === "de_losers" && (
            <span className="text-[10px] text-indigo-400 bg-indigo-950/40 border border-indigo-900/50 px-1.5 py-0.5 rounded normal-case">
              auto-syncs with WB — set WB rounds to fill these
            </span>
          )}
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
          <SubSectionRows sub={sub} isDE={isDE} {...rowProps} />
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
  deadlineDay,
  isDE,
  wbMaxRound,
}: {
  sub: SubSection;
  scheduleByKey: Map<string, RoundScheduleRow>;
  lockedSet: Set<string>;
  tournamentId: string | null;
  matchesByRound: Record<string, RoundMatchInfo[]>;
  playHour: number;
  deadlineDay: number;
  isDE: boolean;
  wbMaxRound?: number;
}) {
  return (
    <div>
      {sub.rows.map(({ stage, round, maxRound }) => {
        const key = `${stage}:${round}`;
        const schedule = scheduleByKey.get(key);
        const prevSchedule = round > 1 ? scheduleByKey.get(`${stage}:${round - 1}`) : undefined;
        const isLocked = lockedSet.has(key);

        // LB rounds 1..(numWB-1) are driven by WB (WB round N → LB round N-1) and
        // are read-only. Deeper LB rounds (>= numWB) are scheduled manually.
        if (stage === "de_losers" && wbMaxRound != null && round < wbMaxRound) {
          return (
            <AutoSyncedRow
              key={`${key}:${schedule ? "set" : "unset"}`}
              stage={stage}
              round={round}
              maxRound={maxRound}
              schedule={schedule}
              wbRound={round + 1}
              wbMaxRound={wbMaxRound}
            />
          );
        }

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
            deadlineDay={deadlineDay}
            isDeAutoSynced={false}
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
  deadlineDay,
  isDE,
}: {
  group: SchedulingGroup;
  scheduleByKey: Map<string, RoundScheduleRow>;
  lockedSet: Set<string>;
  tournamentId: string | null;
  matchesByRound: Record<string, RoundMatchInfo[]>;
  playHour: number;
  deadlineDay: number;
  isDE: boolean;
}) {
  const [open, setOpen] = useState(true);
  const hasSubHeaders = group.subs.length > 1;
  const totalRows = group.subs.reduce((n, s) => n + s.rows.length, 0);

  // WB max round drives which LB rounds are read-only (LB 1..numWB-1 are WB-synced).
  const wbSub = group.subs.find((s) => s.stage === "de_winners");
  const wbMaxRound = wbSub && wbSub.rows.length
    ? Math.max(...wbSub.rows.map((r) => r.round))
    : undefined;

  const subProps = { scheduleByKey, lockedSet, tournamentId, matchesByRound, playHour, deadlineDay, isDE, wbMaxRound };

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
  deadlineDay,
  isDE,
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
          deadlineDay={deadlineDay}
          isDE={isDE}
        />
      ))}
    </div>
  );
}
