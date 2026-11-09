"use client";

import { useState, useTransition } from "react";
import { saveNotificationPrefs } from "./actions";
import type { NotificationCategory } from "@/app/lib/push";
type Category = {
  key: NotificationCategory;
  label: string;
  description: string;
};

const TRADES_CATEGORY: Category = {
  key: "fantasy_trades",
  label: "Trades",
  description: "Offers you receive, and your trades being accepted, rejected or cancelled",
};

const FANTASY_CATEGORIES: Category[] = [
  {
    key: "fantasy_draft",
    label: "Fantasy draft",
    description: "Your draft starting, being on the clock, and picks made for you when time ran out",
  },
  {
    key: "fantasy_waivers",
    label: "Waiver claims",
    description: "Which of your claims won or lost, once a day after the 4 AM Pacific waiver run",
  },
  {
    key: "fantasy_lineup",
    label: "Lineup alerts",
    description: "A starter of yours with a bye or no team this week",
  },
  {
    key: "fantasy_results",
    label: "Results and playoffs",
    description: "Your weekly matchup result, playoff seeding, elimination and the champion",
  },
  {
    key: "fantasy_league",
    label: "League changes",
    description: "A manager leaving or being removed, the owner removing you, and a new league owner",
  },
];

const CATEGORIES: Category[] = [
  {
    key: "tournament",
    label: "Tournament updates",
    description: "Sign-ups opening and closing for upcoming tournaments",
  },
  {
    key: "draft",
    label: "Draft",
    description: "Draft starting and teams being finalized",
  },
  {
    key: "season",
    label: "Season",
    description: "Season start and end announcements",
  },
  {
    key: "announcement",
    label: "Announcements",
    description: "League-wide announcements posted by staff",
  },
];

export function NotificationPrefsForm({
  initialPrefs,
  tradesEnabled,
}: {
  initialPrefs: Record<string, boolean>;
  tradesEnabled: boolean;
}) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initialPrefs);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggle(key: string) {
    const next = { ...prefs, [key]: prefs[key] === false ? true : false };
    setPrefs(next);
    setSaved(false);
    startTransition(async () => {
      await saveNotificationPrefs(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  const enabled = (key: string) => prefs[key] !== false;

  const rows = (categories: Category[]) =>
    categories.map(({ key, label, description }) => (
        <div
          key={key}
          className="flex items-center justify-between gap-4 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-300">{label}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={enabled(key)}
              onChange={() => toggle(key)}
              disabled={isPending}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-pure-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 peer-disabled:opacity-50" />
          </label>
        </div>
      ));

  return (
    <div className="space-y-2">
      {rows(CATEGORIES)}
      <h3 className="pt-3 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Fantasy</h3>
      {rows(tradesEnabled ? [...FANTASY_CATEGORIES.slice(0, 2), TRADES_CATEGORY, ...FANTASY_CATEGORIES.slice(2)] : FANTASY_CATEGORIES)}
      {saved && <p className="text-xs text-emerald-400 px-1">Preferences saved.</p>}
    </div>
  );
}
