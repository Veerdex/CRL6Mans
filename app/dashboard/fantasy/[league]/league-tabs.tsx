"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "roster", label: "Roster" },
  { segment: "matchup", label: "Matchup" },
  { segment: "players", label: "Players" },
  { segment: "", label: "League" },
] as const;

export function LeagueTabs({ leagueId }: { leagueId: string }) {
  const pathname = usePathname();
  // The clicked tab lights up before the route commits, and is dropped the moment the
  // pathname moves, so a later back/forward to the same page can't revive it.
  const [clicked, setClicked] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setClicked(null);
  }
  const current = clicked ?? pathname;
  const base = `/dashboard/fantasy/${leagueId}`;
  return (
    <nav aria-label="League sections" className="sticky top-0 z-10 grid grid-cols-4 border-b border-zinc-700 bg-zinc-800">
      {TABS.map(({ segment, label }, i) => {
        const href = segment ? `${base}/${segment}` : base;
        const active = segment ? current.startsWith(href) : current === base;
        return (
          <Link
            key={label}
            href={href}
            onClick={(e) => {
              if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) setClicked(href);
            }}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-center min-h-12 px-2 text-sm font-semibold transition-colors ${
              i > 0 ? "border-l border-zinc-700" : ""
            } ${active ? "bg-indigo-600 text-on-accent" : "text-zinc-300 hover:bg-zinc-700 hover:text-white"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
