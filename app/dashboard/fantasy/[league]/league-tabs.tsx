"use client";

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
  const base = `/dashboard/fantasy/${leagueId}`;
  return (
    <nav aria-label="League sections" className="flex justify-center">
      <div className="inline-flex gap-1 p-1 bg-zinc-800 border border-zinc-700 rounded-full">
        {TABS.map(({ segment, label }) => {
          const href = segment ? `${base}/${segment}` : base;
          const active = segment ? pathname.startsWith(href) : pathname === base;
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active ? "bg-indigo-600 text-on-accent" : "text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
