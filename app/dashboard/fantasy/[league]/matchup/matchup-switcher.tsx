"use client";

import { useState, type ReactNode } from "react";

// Every week and matchup is rendered on the server up front; these only choose
// which one shows, so switching never waits on a request. The URL follows along
// so a refresh or a shared link opens on the same view.
function syncUrl(params: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!("manager" in params)) url.searchParams.delete("manager");
  window.history.replaceState(null, "", url);
}

export type WeekTab = { week: number; label: string; current: boolean };

export function WeekSwitcher({ tabs, initial, panels }: { tabs: WeekTab[]; initial: number; panels: Record<number, ReactNode> }) {
  const [week, setWeek] = useState(initial);
  return (
    <>
      <nav aria-label="Weeks" className="flex flex-wrap justify-center gap-2">
        {tabs.map((t) => {
          const active = t.week === week;
          return (
            <button
              key={t.week}
              type="button"
              onClick={() => {
                setWeek(t.week);
                syncUrl({ week: String(t.week) });
              }}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active ? "bg-indigo-500 border-indigo-500 text-on-accent" : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {t.label}
              {t.current && (
                <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-pure-white" : "bg-emerald-400"}`} aria-label="current week" />
              )}
            </button>
          );
        })}
      </nav>
      {panels[week]}
    </>
  );
}

export type MatchupChip = {
  managerId: string;
  a: string;
  b: string | null;
  score: string;
  aWon: boolean;
  bWon: boolean;
  aIsViewer: boolean;
  bIsViewer: boolean;
};

// The viewer's own name stands out from a winner's, so their matchup is easy to find again.
function chipNameClass(won: boolean, isViewer: boolean) {
  if (isViewer) return "text-indigo-400 font-bold";
  return won ? "text-white font-semibold" : "text-zinc-300";
}

export function MatchupSwitcher({
  week,
  chips,
  boards,
  initial,
}: {
  week: number;
  chips: MatchupChip[];
  boards: ReactNode[];
  initial: number;
}) {
  const [shown, setShown] = useState(initial);
  const others = chips.map((c, i) => ({ c, i })).filter(({ i }) => i !== shown);
  return (
    <>
      {boards[shown]}
      {others.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Other matchups</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {others.map(({ c, i }) => (
              <li key={c.managerId}>
                <button
                  type="button"
                  onClick={() => {
                    setShown(i);
                    syncUrl({ week: String(week), manager: c.managerId });
                  }}
                  className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-left transition-colors hover:bg-zinc-800"
                >
                  <span className={`truncate ${chipNameClass(c.aWon, c.aIsViewer)}`}>{c.a}</span>
                  <span className="tabular-nums text-zinc-400">{c.score}</span>
                  <span className={`truncate text-right ${chipNameClass(c.bWon, c.bIsViewer)}`}>{c.b ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
