"use client";

import { useState, useEffect } from "react";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Distinct colors cycled per round.
const COLORS = [
  { bar: "bg-indigo-500/45 border-indigo-400",  text: "text-white",  dot: "bg-indigo-500" },
  { bar: "bg-emerald-500/45 border-emerald-400", text: "text-white", dot: "bg-emerald-500" },
  { bar: "bg-amber-500/45 border-amber-400",    text: "text-white",   dot: "bg-amber-500" },
  { bar: "bg-rose-500/45 border-rose-400",      text: "text-white",    dot: "bg-rose-500" },
  { bar: "bg-sky-500/45 border-sky-400",        text: "text-white",     dot: "bg-sky-500" },
  { bar: "bg-fuchsia-500/45 border-fuchsia-400", text: "text-white", dot: "bg-fuchsia-500" },
  { bar: "bg-teal-500/45 border-teal-400",      text: "text-white",    dot: "bg-teal-500" },
  { bar: "bg-orange-500/45 border-orange-400",  text: "text-white",  dot: "bg-orange-500" },
];

export type CalEntry = {
  uid: string; // unique key (round window or individual pinned match)
  stage: string;
  round: number;
  scheduleType: string;
  rangeDays: number | null;
  playAt: string;
  label: string;
  stageName: string;
};

// Local calendar-day (00:00) as a synthetic UTC instant — lets us do whole-day
// arithmetic safely. All bucketing/formatting is the VIEWER's local zone (the app has
// no canonical zone); the component renders only after mount so this never mismatches.
function dayBucket(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function fullDate(dayMs: number): string {
  return new Date(dayMs).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
function zoneAbbr(): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "local time";
}

type Ev = CalEntry & { start: number; end: number; span: number; specific: boolean; lane: number; colorIdx: number };

export function ScheduleCalendar({ entries }: { entries: CalEntry[] }) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // Render only after mount: day bucketing uses the viewer's local zone, which differs
  // from the server's, so client-only rendering avoids a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">No round schedules set yet. Admins can configure them in the Admin panel.</p>;
  }
  if (!mounted) {
    return <p className="text-sm text-zinc-500">Loading calendar…</p>;
  }

  const evs: Ev[] = entries
    .map((e) => {
      const start = dayBucket(e.playAt);
      const span = e.scheduleType !== "specific" ? (e.rangeDays ?? 1) : 1;
      return { ...e, start, end: start + (span - 1) * DAY, span, specific: e.scheduleType === "specific", lane: 0, colorIdx: 0 };
    })
    .sort((a, b) => a.start - b.start || b.span - a.span);

  evs.forEach((e, i) => { e.colorIdx = i % COLORS.length; });

  // Greedy lane assignment so overlapping windows stack instead of colliding.
  const laneEnds: number[] = [];
  for (const e of evs) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= e.start) lane++;
    if (lane === laneEnds.length) laneEnds.push(e.end);
    else laneEnds[lane] = e.end;
    e.lane = lane;
  }
  const laneCount = Math.max(1, laneEnds.length);

  // Count of specific entries per day (for the "N matches" badge / click affordance).
  const specificByDay = new Map<number, number>();
  for (const e of evs) {
    if (e.specific) specificByDay.set(e.start, (specificByDay.get(e.start) ?? 0) + 1);
  }
  const anyByDay = new Set(evs.flatMap((e) => {
    const days: number[] = [];
    for (let d = e.start; d <= e.end; d += DAY) days.push(d);
    return days;
  }));

  const minStart = Math.min(...evs.map((e) => e.start));
  const maxEnd = Math.max(...evs.map((e) => e.end));
  const firstSun = minStart - new Date(minStart).getUTCDay() * DAY;
  const lastSat = maxEnd + (6 - new Date(maxEnd).getUTCDay()) * DAY;
  const weeks: number[] = [];
  for (let w = firstSun; w <= lastSat; w += 7 * DAY) weeks.push(w);

  const HEADER = 30;
  const LANE_H = 32;
  const MIN_ROW = 150;
  const rowHeight = Math.max(MIN_ROW, HEADER + laneCount * LANE_H + 10);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-zinc-500">
        All times shown in your local timezone (<span className="text-zinc-400">{zoneAbbr()}</span>).
      </p>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
        {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>

      <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
        {weeks.map((wk) => {
          const wkEnd = wk + 6 * DAY;
          const weekEvs = evs.filter((e) => e.end >= wk && e.start <= wkEnd);
          return (
            <div key={wk} className="relative border-b border-zinc-800 last:border-b-0" style={{ height: rowHeight }}>
              <div className="grid grid-cols-7 h-full">
                {Array.from({ length: 7 }, (_, i) => {
                  const dayMs = wk + i * DAY;
                  const d = new Date(dayMs);
                  const isFirst = d.getUTCDate() === 1;
                  const numLabel = isFirst
                    ? `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`
                    : `${d.getUTCDate()}`;
                  const specCount = specificByDay.get(dayMs) ?? 0;
                  const clickable = anyByDay.has(dayMs);
                  return (
                    <div key={i} className="relative border-r border-zinc-800/50 last:border-r-0">
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => setSelectedDay(dayMs)}
                        className={`w-full flex items-center justify-between gap-1 px-1.5 pt-1 text-left ${clickable ? "cursor-pointer hover:bg-zinc-800/40" : "cursor-default"}`}
                        style={{ height: HEADER }}
                      >
                        <span className="text-[11px] text-zinc-500">{numLabel}</span>
                        {specCount > 0 && (
                          <span className="text-[9px] font-semibold text-zinc-300 bg-zinc-700/70 rounded-full px-1.5 leading-tight">
                            {specCount}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {weekEvs.map((e) => {
                const segStart = Math.max(e.start, wk);
                const segEnd = Math.min(e.end, wkEnd);
                const colStart = Math.round((segStart - wk) / DAY);
                const cols = Math.round((segEnd - segStart) / DAY) + 1;
                const c = COLORS[e.colorIdx];
                const startsHere = e.start >= wk;
                const endsHere = e.end <= wkEnd;
                const text = e.specific ? `${clockTime(e.playAt)} · ${e.label}` : startsHere ? e.label : "";
                return (
                  <button
                    type="button"
                    key={e.uid}
                    onClick={() => setSelectedDay(segStart)}
                    className={`absolute border ${c.bar} ${c.text} text-[11px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.6)] leading-none px-2 flex items-center overflow-hidden whitespace-nowrap cursor-pointer hover:brightness-125 transition ${startsHere ? "rounded-l-md" : ""} ${endsHere ? "rounded-r-md" : ""}`}
                    style={{
                      left: `calc(${(colStart / 7) * 100}% + 2px)`,
                      width: `calc(${(cols / 7) * 100}% - 4px)`,
                      top: HEADER + e.lane * LANE_H,
                      height: LANE_H - 4,
                    }}
                    title={`${e.stageName} · ${e.label}${e.specific ? ` — ${localTime(e.playAt)}` : ""}`}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {evs.map((e) => (
          <div key={e.uid} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`w-2.5 h-2.5 rounded-sm ${COLORS[e.colorIdx].dot}`} />
            <span><span className="text-zinc-500">{e.stageName} ·</span> {e.label}</span>
          </div>
        ))}
      </div>

      {selectedDay !== null && (
        <DayModal day={selectedDay} evs={evs} onClose={() => setSelectedDay(null)} />
      )}
    </div>
  );
}

function DayModal({ day, evs, onClose }: { day: number; evs: Ev[]; onClose: () => void }) {
  const specifics = evs
    .filter((e) => e.specific && e.start === day)
    .map((e) => ({ ...e, minutes: minutesOfDay(e.playAt) }))
    .sort((a, b) => a.minutes - b.minutes);
  const windows = evs.filter((e) => !e.specific && e.start <= day && e.end >= day);

  const HOUR_H = 26;
  const total = 24 * HOUR_H;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">{fullDate(day)}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none px-1">×</button>
        </div>

        {windows.length > 0 && (
          <div className="px-5 pt-3 flex flex-wrap gap-1.5">
            {windows.map((w) => (
              <span key={w.uid} className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${COLORS[w.colorIdx].bar} ${COLORS[w.colorIdx].text}`}>
                {w.stageName} · {w.label} — all day
              </span>
            ))}
          </div>
        )}

        <div className="overflow-y-auto px-5 py-3">
          {specifics.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4 text-center">No fixed match times on this day.</p>
          ) : (
            <div className="relative" style={{ height: total }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="absolute left-0 right-0 flex items-start gap-2" style={{ top: h * HOUR_H }}>
                  <span className="text-[10px] text-zinc-600 w-12 shrink-0 -translate-y-1.5 text-right">
                    {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                  </span>
                  <div className="flex-1 border-t border-zinc-800/70" />
                </div>
              ))}
              {specifics.map((s) => {
                const c = COLORS[s.colorIdx];
                return (
                  <div
                    key={s.uid}
                    className={`absolute left-14 right-0 border rounded-md px-2 py-1 ${c.bar} ${c.text}`}
                    style={{ top: (s.minutes / 60) * HOUR_H }}
                  >
                    <span className="text-[11px] font-semibold">{localTime(s.playAt)}</span>
                    <span className="text-[11px]"> · {s.stageName} · {s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
