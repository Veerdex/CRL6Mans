"use client";

import { useState, useTransition } from "react";
import { setAdminNotificationPref } from "./league-actions";

const ITEMS: { key: string; label: string; desc: string }[] = [
  { key: "match_reporting", label: "Match Reporting",          desc: "When a team submits a series result." },
  { key: "sub_requests",    label: "Sub Requests",             desc: "When a team requests a substitute." },
  { key: "registrations",   label: "Pending Registrations",    desc: "When a new player submits a registration." },
  { key: "profile_changes", label: "Profile Change Requests",  desc: "When a player requests an MMR / tracker change." },
];

export function AdminNotificationToggles({ initial }: { initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initial);
  const [, startTransition] = useTransition();

  const toggle = (key: string) => {
    const next = !(prefs[key] !== false); // current state is on unless explicitly false
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(() => { setAdminNotificationPref(key, next); });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Push notifications sent to staff. Turn off any you don&apos;t want to receive.
      </p>
      {ITEMS.map((item) => {
        const on = prefs[item.key] !== false;
        return (
          <div key={item.key} className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">{item.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              role="switch"
              aria-checked={on}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none ${
                on ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
