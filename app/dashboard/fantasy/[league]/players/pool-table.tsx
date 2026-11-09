"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { PoolPlayer, PoolTeam } from "@/app/lib/fantasy-pool-data";
import { TIER_LABEL, TIER_NAME_CLASS, type FantasyTier } from "@/app/lib/fantasy-pool";
import { formatRating } from "@/app/lib/rating";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { TeamLink } from "@/app/dashboard/team-link";
import { LocalTime } from "@/app/dashboard/local-time";

type SortKey = "name" | "tier" | "team" | "rating" | "projected" | "seasonPoints" | "average";
type TierFilter = "all" | FantasyTier;

const TIER_STYLE: Record<FantasyTier, string> = {
  1: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  2: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
  3: "bg-zinc-700/60 text-zinc-300 border-zinc-600",
};

const PROJECTION_TITLE =
  "Projected points for the next series, win bonus included — from the player's rating, blended with their own stat history as it builds up, and adjusted for their team's chances against the opponent. With no match scheduled it assumes an even matchup.";

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
type StatusFilter = "everyone" | "available" | "waivers";

export function PoolTable({
  players,
  renderAction,
  defaultAvailableOnly = false,
}: {
  players: PoolPlayer[];
  /** A trailing cell per player, e.g. the draft room's Draft button. */
  renderAction?: (player: PoolPlayer) => ReactNode;
  defaultAvailableOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<TierFilter>("all");
  const [status, setStatus] = useState<StatusFilter>(defaultAvailableOnly ? "available" : "everyone");
  const anyOnWaivers = players.some((p) => !p.manager && p.waiverClearsAt);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "projected", asc: false });
  const [expanded, setExpanded] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = players.filter(
      (p) =>
        (tier === "all" || p.tier === tier) &&
        (status === "everyone" ||
          (!p.manager && (status === "waivers") === !!p.waiverClearsAt)) &&
        (!q || p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q) || p.team?.name.toLowerCase().includes(q)),
    );
    const dir = sort.asc ? 1 : -1;
    return filtered.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return c * dir || b.projected - a.projected;
    });
  }, [players, query, tier, status, sort]);

  // Against the whole pool, not the filtered rows, so a player's colour doesn't
  // change with the search box.
  const seasonPointsColor = useMemo(() => {
    const t = rankShare(players.filter((p) => p.seriesPlayed > 0).map((p) => p.seasonPoints));
    return (p: PoolPlayer) => (p.seriesPlayed > 0 ? spectrum(t(p.seasonPoints), 0, 1) : undefined);
  }, [players]);

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
        <Chip active={status === "everyone"} onClick={() => setStatus("everyone")}>Everyone</Chip>
        <Chip active={status === "available"} onClick={() => setStatus("available")}>Available</Chip>
        {anyOnWaivers && (
          <Chip active={status === "waivers"} onClick={() => setStatus("waivers")}>Waivers</Chip>
        )}
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
              {renderAction && <th className="px-3 py-2"><span className="sr-only">Action</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-700/60">
            {shown.map((p) => (
              <tr key={p.id} className="even:bg-zinc-700/30 hover:bg-zinc-700/60">
                <td className="px-3 py-2">
                  <NameCell player={p} />
                </td>
                <td className="px-3 py-2"><TierBadge tier={p.tier} /></td>
                <td className="px-3 py-2"><TeamCell team={p.team} /></td>
                <td className="px-3 py-2"><Availability player={p} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200" style={ratingColor(p.rating)}>{formatRating(p.rating)}</td>
                <td className="px-3 py-2 text-right"><Projection player={p} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200" style={seasonPointsColor(p)}>{fmt(p.seasonPoints)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200" style={pointsColor(average(p))}>
                  {average(p) === null ? "—" : fmt(average(p)!)}
                </td>
                <td className="px-3 py-2"><OpponentCell team={p.nextOpponent} /></td>
                {renderAction && <td className="px-3 py-2 text-right">{renderAction(p)}</td>}
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
                <li key={p.id} className="even:bg-zinc-700/30">
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
                    <Availability player={p} compact />
                    <div className="w-14 text-right"><Projection player={p} /></div>
                    {renderAction && (
                      // Its own click target, so drafting doesn't also toggle the row.
                      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        {renderAction(p)}
                      </div>
                    )}
                  </div>
                  {open && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-3 text-xs">
                      <Detail label="Team"><TeamCell team={p.team} /></Detail>
                      <Detail label="Fantasy"><Availability player={p} /></Detail>
                      <Detail label="RV"><span style={ratingColor(p.rating)}>{formatRating(p.rating)}</span></Detail>
                      <Detail label="Season points"><span style={seasonPointsColor(p)}>{fmt(p.seasonPoints)}</span></Detail>
                      <Detail label="Per series">
                        <span style={pointsColor(average(p))}>{average(p) === null ? "—" : fmt(average(p)!)}</span>
                      </Detail>
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
        <PlayerName displayName={player.name} username={player.username} discordId={player.discordId || null} className={`text-sm font-medium ${TIER_NAME_CLASS[player.tier]}`} />
      </div>
    </div>
  );
}

export function TierBadge({ tier }: { tier: FantasyTier }) {
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

function Availability({ player, compact = false }: { player: PoolPlayer; compact?: boolean }) {
  const { manager, waiverClearsAt } = player;
  if (manager) {
    const label = `On ${manager.name}'s roster`;
    return compact ? (
      <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" title={label} aria-label={label} />
    ) : (
      <span className="text-xs text-zinc-400 truncate" title={label}>{manager.name}</span>
    );
  }
  if (waiverClearsAt) {
    return compact ? (
      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="On waivers" aria-label="On waivers" />
    ) : (
      <span className="text-xs text-amber-300 whitespace-nowrap">
        Waivers · <LocalTime iso={waiverClearsAt} weekday />
      </span>
    );
  }
  return compact ? (
    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Available" aria-label="Available" />
  ) : (
    <span className="text-xs text-emerald-300">Available</span>
  );
}

// Red at or below `low`, yellow at the midpoint, green at or above `high`. Mixing
// the theme's own tokens keeps every point on the scale readable in each theme.
function spectrum(value: number | null, low: number, high: number): React.CSSProperties | undefined {
  if (value === null) return undefined;
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  const [from, to, share] =
    t < 0.5 ? ["--c-red-400", "--c-yellow-400", t * 2] : ["--c-yellow-400", "--c-emerald-400", (t - 0.5) * 2];
  return { color: `color-mix(in oklab, var(${from}), var(${to}) ${Math.round(share * 100)}%)` };
}

// Where a value sits in `values`: 0 below everyone, 1 above everyone, so the
// whole pool spans red to green and ties share a colour. Null with nothing to
// separate (an empty pool, or everyone level).
function rankShare(values: number[]): (v: number) => number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const countWhere = (inLowerPart: (x: number) => boolean) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inLowerPart(sorted[mid])) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  return (v) => {
    const below = countWhere((x) => x < v);
    const above = sorted.length - countWhere((x) => x <= v);
    return below + above ? below / (below + above) : null;
  };
}

const pointsColor = (v: number | null) => spectrum(v, 10, 40);
const ratingColor = (v: number | null) => spectrum(v, 1450, 1850);

function Projection({ player }: { player: PoolPlayer }) {
  const note =
    player.projectionBasis === "rating" ? "No stat history yet: rating only" :
    player.projectionBasis === "provisional" ? "Provisional: little stat history yet" : undefined;
  return (
    <span className="inline-flex items-baseline justify-end gap-1 whitespace-nowrap" title={note ?? PROJECTION_TITLE}>
      {player.projectionBasis !== "history" && (
        <span className="text-[10px] text-zinc-500">{player.projectionBasis === "rating" ? "rating" : "prov."}</span>
      )}
      <span className="tabular-nums font-semibold text-white" style={pointsColor(player.projected)}>{fmt(player.projected)}</span>
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
