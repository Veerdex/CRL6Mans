"use client";

import { useState, useTransition } from "react";
import { setTheme, type Theme } from "./theme-actions";

const BASE_OPTIONS: { value: Theme; label: string }[] = [
  { value: "crl6mans", label: "CRL6Mans" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle({ initial, sponsorTheme }: { initial: Theme; sponsorTheme?: { name: string } | null }) {
  const [theme, setLocal] = useState<Theme>(initial);
  const [, startTransition] = useTransition();

  const OPTIONS = sponsorTheme ? [...BASE_OPTIONS, { value: "sponsor" as Theme, label: sponsorTheme.name }] : BASE_OPTIONS;

  const choose = (next: Theme) => {
    if (next === theme) return;
    setLocal(next);
    document.documentElement.dataset.theme = next; // instant visual flip
    startTransition(() => { setTheme(next); });
  };

  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-zinc-800 border border-zinc-700 rounded-lg">
      <div>
        <p className="text-sm font-medium text-zinc-300">Appearance</p>
        <p className="text-xs text-zinc-500 mt-0.5">Pick a theme. Applied instantly and saved.</p>
      </div>
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-1 shrink-0">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              theme === o.value ? "bg-indigo-600 text-on-accent" : "text-zinc-400 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
