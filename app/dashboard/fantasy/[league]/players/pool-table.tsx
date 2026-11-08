"use client";

import { useMemo, useState } from "react";
import type { PoolPlayer, PoolTeam } from "@/app/lib/fantasy-pool-data";
import { TIER_LABEL, type FantasyTier } from "@/app/lib/fantasy-pool";
import { formatRating } from "@/app/lib/rating";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { TeamLink } from "@/app/dashboard/team-link";

type SortKey = "name" | "tier" | "team" | "rating" | "projected" | "seasonPoints" | "average";
type TierFilter = "all" | FantasyTier;

const TIER_STYLE: Record<FantasyTier, string> = {
  1: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  2: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
  3: "bg-zinc-700/60 text-zinc-300 border-zinc-600",
};

const PROJECTION_TITLE =
  "Projected stat points per series, before the win bonus — from the player's rating, blended with their own stat history as it builds up.";

const average = (p: PoolPlayer) => (p.seriesPlayed ? p.seasonPoints / p.seriesPlayed : null);
const fmt = (n: number) => n.toFixed(1);

function sortValue(p: PoolPlayer, key: SortKey): number | string {
  switch (key) {
    case "name": return p.name.toLowerCase();
    case "tier": return p.tier;
    case "team": return p.team?.name.toLowerCase() ?? "￿";
    case "rating": return p.rating ?? -Infinity;
    case "projected": return p.projected;
    case "seasonPoints": return p.seasonPoints;
    case "average": return average(p) ?? -Infinity;
  }
}

// Text columns read A→Z and tiers Cap first; numbers read best first.
const ASCENDING_FIRST: SortKey[] = ["name", "tier", "team"];

export function PoolTable({ players }: { players: PoolPlayer[] }) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<TierFilter>("all");
  // Every player is available until fantasy rosters exist, so the filter has nothing to remove yet.
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "projected", asc: false });
  const [expanded, setExpanded] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = players.filter(
      (p) =>
        (tier === "all" || p.tier === tier) &&
        (!q || p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q) || p.team?.name.toLowerCase().includes(q)),
    );
    const dir = sort.asc ? 1 : -1;
    return filtered.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return c * dir || b.projected - a.projected;
    });
  }, [players, query, tier, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: ASCENDING_FIRST.includes(key) }));

  const header = (key: SortKey, label: string, className = "", title?: string) => (
    <th className={`px-3 py-2 font-medium ${className}`} title={title}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 hover:text-white ${sort.key === key ? "text-white" : ""}`}
      >
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.asc ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search players or teams"
        className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
      />
      <div className="flex flex-wrap items-center gap-2">
        {(["all", 1, 2, 3] as TierFilter[]).map((t) => (
          <Chip key={t} active={tier === t} onClick={() => setTier(t)}>
            {t === "all" ? "All tiers" : TIER_LABEL[t]}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-zinc-700" aria-hidden="true" />
        <Chip active={!availableOnly} onClick={() => setAvailableOnly(false)}>Everyone</Chip>
        <Chip active={availableOnly} onClick={() => setAvailableOnly(true)}>Available</Chip>
        <span className="ml-auto text-xs text-zinc-400">
          {shown.length} of {players.length}
        </span>
      </div>

      <div className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
        {/* Desktop */}
        <table className="hidden md:table w-full text-sm">
          <thead className="text-left text-xs text-zinc-400 border-b border-zinc-700">
            <tr>
              {header("name", "Player")}
              {header("tier", "Tier")}
              {header("team", "Team")}
              <th className="px-3 py-2 font-medium">Status</th>
              {header("rating", "RV", "text-right")}
              {header("projected", "Proj", "text-right", PROJECTION_TITLE)}
              {header("seasonPoints", "Pts", "text-right")}
              {header("average", "Avg", "text-right")}
              <th className="px-3 py-2 font-medium">Next</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-700/60">
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-zinc-700/30">
                <td className="px-3 py-2">
                  <NameCell player={p} />
                </td>
                <td className="px-3 py-2"><TierBadge tier={p.tier} /></td>
                <td className="px-3 py-2"><TeamCell team={p.team} /></td>
                <td className="px-3 py-2"><Availability /></td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{formatRating(p.rating)}</td>
                <td className="px-3 py-2 text-right"><Projection player={p} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{fmt(p.seasonPoints)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200">
                  {average(p) === null ? "—" : fmt(average(p)!)}
                </td>
                <td className="px-3 py-2"><OpponentCell team={p.nextOpponent} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile */}
        <div className="md:hidden">
          <div className="flex items-center gap-3 px-3 py-2 text-xs text-zinc-400 border-b border-zinc-700">
            <SortButton label="Player" k="name" sort={sort} onSort={toggleSort} className="flex-1 text-left" />
            <SortButton label="Proj" k="projected" sort={sort} onSort={toggleSort} />
          </div>
          <ul className="divide-y divide-zinc-700/60">
            {shown.map((p) => {
              const open = expanded === p.id;
              return (
                <li key={p.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded(open ? null : p.id);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                  >
                    <div className="flex-1 min-w-0"><NameCell player={p} /></div>
                    <TierBadge tier={p.tier} />
                    <Availability compact />
                    <div className="w-14 text-right"><Projection player={p} /></div>
                  </div>
                  {open && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-3 text-xs">
                      <Detail label="Team"><TeamCell team={p.team} /></Detail>
                      <Detail label="RV">{formatRating(p.rating)}</Detail>
                      <Detail label="Season points">{fmt(p.seasonPoints)}</Detail>
                      <Detail label="Per series">{average(p) === null ? "—" : fmt(average(p)!)}</Detail>
                      <Detail label="Next match"><OpponentCell team={p.nextOpponent} /></Detail>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {shown.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-zinc-400">No players match that search.</p>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-indigo-500 border-indigo-500 text-on-accent" : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function SortButton({
  label, k, sort, onSort, className = "",
}: { label: string; k: SortKey; sort: { key: SortKey; asc: boolean }; onSort: (k: SortKey) => void; className?: string }) {
  return (
    <button type="button" onClick={() => onSort(k)} className={`${className} ${sort.key === k ? "text-white" : ""}`}>
      {label}
      {sort.key === k && <span aria-hidden="true"> {sort.asc ? "▲" : "▼"}</span>}
    </button>
  );
}

function NameCell({ player }: { player: PoolPlayer }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <PlayerAvatar discordId={player.discordId} avatar={player.avatar} username={player.username} className="w-7 h-7" cdnSize={64} />
      <div className="min-w-0 flex whitespace-nowrap">
        <PlayerName displayName={player.name} username={player.username} discordId={player.discordId || null} className="text-sm text-white" />
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: FantasyTier }) {
  return (
    <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${TIER_STYLE[tier]}`}>
      {TIER_LABEL[tier]}
    </span>
  );
}

function TeamCell({ team }: { team: PoolTeam | null }) {
  if (!team) return <span className="text-zinc-400">Free agent</span>;
  return (
    <TeamLink teamId={team.id} name={team.name} className="truncate min-w-0 text-zinc-200">
      {team.name}
    </TeamLink>
  );
}

function OpponentCell({ team }: { team: PoolTeam | null }) {
  if (!team) return <span className="text-zinc-500">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 text-zinc-300">
      <span className="text-zinc-500">vs</span>
      <TeamCell team={team} />
    </span>
  );
}

// Every player is available until fantasy rosters exist.
function Availability({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Available" aria-label="Available" />
  ) : (
    <span className="text-xs text-emerald-300">Available</span>
  );
}

function Projection({ player }: { player: PoolPlayer }) {
  const note =
    player.projectionBasis === "rating" ? "No stat history yet: rating only" :
    player.projectionBasis === "provisional" ? "Provisional: little stat history yet" : undefined;
  return (
    <span className="inline-flex flex-col items-end leading-tight" title={note ?? PROJECTION_TITLE}>
      <span className="tabular-nums font-semibold text-white">{fmt(player.projected)}</span>
      {player.projectionBasis !== "history" && (
        <span className="text-[10px] text-zinc-500">{player.projectionBasis === "rating" ? "rating" : "prov."}</span>
      )}
    </span>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 truncate">{children}</dd>
    </div>
  );
}
