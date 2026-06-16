"use client";

import { useState, useTransition } from "react";
import { saveNotificationPrefs } from "./actions";
import type { NotificationCategory } from "@/app/lib/push";

type Category = {
  key: NotificationCategory;
  label: string;
  description: string;
};

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
];

export function NotificationPrefsForm({
  initialPrefs,
}: {
  initialPrefs: Record<string, boolean>;
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

  return (
    <div className="space-y-2">
      {CATEGORIES.map(({ key, label, description }) => (
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
      ))}
      {saved && <p className="text-xs text-emerald-400 px-1">Preferences saved.</p>}
    </div>
  );
}
