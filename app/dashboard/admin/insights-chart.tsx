"use client";

import { useState } from "react";

export type InsightsPoint = {
  label: string;
  visits: number;
  registrations: number;
  draftJoins: number;
};

const SERIES = [
  { key: "visits",        label: "Visits",        color: "#6366f1" },
  { key: "registrations", label: "Registrations", color: "#10b981" },
  { key: "draftJoins",    label: "Draft Joins",   color: "#f59e0b" },
] as const;
type SeriesKey = typeof SERIES[number]["key"];

// Pick a "nice" integer step (1, 2, 5, 10, 20, …) for the y-axis ticks.
function niceStep(rough: number): number {
  if (rough <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return s * pow;
}

export function InsightsChart({ data }: { data: InsightsPoint[] }) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const visible = SERIES.filter((s) => !hidden.has(s.key));

  const W = 760, H = 320, padL = 36, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = data.length;

  const maxVal = Math.max(1, ...data.flatMap((d) => visible.map((s) => d[s.key])));
  const step = niceStep(maxVal / 4);
  const yMax = step * (Math.floor(maxVal / step) + 1); // integer ticks + headroom above the peak
  const tickCount = Math.round(yMax / step);

  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  const toggle = (k: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  return (
    <div className="space-y-3 max-w-5xl mx-auto">
      <p className="text-xs text-zinc-500">Last 52 weeks. Toggle a metric to compare.</p>

      {/* Legend toggles */}
      <div className="flex flex-wrap gap-2">
        {SERIES.map((s) => {
          const on = !hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                on ? "border-zinc-600 bg-zinc-800 text-white" : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: on ? s.color : "#3f3f46" }} />
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]">
          {/* gridlines + y labels */}
          {Array.from({ length: tickCount + 1 }, (_, i) => {
            const val = step * i;
            const yy = y(val);
            return (
              <g key={i}>
                <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#27272a" strokeWidth="1" />
                <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize="9" fill="#71717a">{val}</text>
              </g>
            );
          })}

          {/* x labels — thinned so 52 weeks stay legible (~every 4th + the last) */}
          {data.map((d, i) =>
            i % 4 === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize="9" fill="#71717a">{d.label}</text>
            ) : null
          )}

          {/* series */}
          {visible.map((s) => (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")}
              />
              {data.map((d, i) => (
                <circle key={i} cx={x(i)} cy={y(d[s.key])} r="2" fill={s.color}>
                  <title>{`${d.label} — ${s.label}: ${d[s.key]}`}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
