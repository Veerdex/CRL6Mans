"use client";

import { useState } from "react";

export type SeasonTab = {
  key: string;
  label: string;
  content: React.ReactNode;
};

export function SeasonTabs({ tabs, defaultTab }: { tabs: SeasonTab[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="overflow-x-auto border-b border-zinc-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-1 min-w-max">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap ${
                t.key === active
                  ? "text-white border-indigo-500 font-bold"
                  : "text-zinc-500 border-transparent hover:text-zinc-300 font-medium"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active tab content */}
      <div>{current?.content}</div>
    </div>
  );
}
