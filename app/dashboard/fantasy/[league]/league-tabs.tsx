"use client";

import Link from "next/link";
import { useNavPathname } from "@/app/dashboard/use-nav-pathname";
import type { FantasyLeagueStatus } from "@/app/lib/fantasy-rules";

const TABS = [
  { segment: "roster", label: "Roster" },
  { segment: "matchup", label: "Matchup" },
  { segment: "players", label: "Players" },
  { segment: "", label: "League" },
] as const;

// The Draft tab exists only while the league is drafting, and leads the row then.
const DRAFT_TAB = { segment: "draft", label: "Draft" } as const;

export function LeagueTabs({ leagueId, status }: { leagueId: string; status: FantasyLeagueStatus }) {
  const current = useNavPathname();
  const base = `/dashboard/fantasy/${leagueId}`;
  const tabs = status === "drafting" ? [DRAFT_TAB, ...TABS] : TABS;
  return (
    <nav
      aria-label="League sections"
      className={`sticky top-0 z-10 grid ${tabs.length === 5 ? "grid-cols-5" : "grid-cols-4"} border-b border-zinc-700 bg-zinc-800`}
    >
      {tabs.map(({ segment, label }, i) => {
        const href = segment ? `${base}/${segment}` : base;
        const active = segment ? current.startsWith(href) : current === base;
        return (
          <Link
            key={label}
            href={href}
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
