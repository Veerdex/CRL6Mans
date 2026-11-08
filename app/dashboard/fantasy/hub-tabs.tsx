"use client";

import { useState } from "react";

export type HubTab = "mine" | "all";

// Both lists arrive from one server render, so switching is local: no round trip,
// with the URL kept in step so a refresh or a shared link opens the same tab.
export function HubTabs({ initial, mine, all }: { initial: HubTab; mine: React.ReactNode; all: React.ReactNode }) {
  const [tab, setTab] = useState(initial);
  const select = (next: HubTab) => {
    setTab(next);
    window.history.replaceState(null, "", `/dashboard/fantasy?tab=${next}`);
  };
  const pill = (value: HubTab, label: string) => (
    <button
      type="button"
      onClick={() => select(value)}
      aria-pressed={tab === value}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        tab === value ? "bg-indigo-600 text-on-accent" : "text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="flex justify-center">
        <div className="inline-flex gap-1 p-1 bg-zinc-800 border border-zinc-700 rounded-full">
          {pill("mine", "My Leagues")}
          {pill("all", "All Leagues")}
        </div>
      </div>
      {tab === "mine" ? mine : all}
    </>
  );
}
