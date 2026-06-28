"use client";

import { useState, useMemo, useCallback } from "react";
import { computeGroupStandings, type GroupStanding } from "@/app/lib/bracket";

export type GroupMatchRow = {
  id: string;
  round: number;
  match_number: number;
  stage: string;
  groupNum: number;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

export type GroupTeam = { id: string; name: string; logo_url: string | null };

interface GroupStageClientProps {
  groupNums: number[];
  matches: GroupMatchRow[];
  teams: Record<string, GroupTeam>;
  qualifiersPerGroup: number;
  topDirectQualifiers: number;
  teamTitles: Record<string, string>;
}

export function GroupStageClient({ groupNums, matches, teams, qualifiersPerGroup, topDirectQualifiers, teamTitles }: GroupStageClientProps) {
  const [selectedGroup, setSelectedGroup] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  // Start with fully-played rounds collapsed — but if the whole stage is done,
  // leave everything expanded.
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(() => {
    const allDone = matches.length > 0 && matches.every((m) => m.status === "completed");
    if (allDone) return new Set<number>();
    const doneByRound = new Map<number, boolean>();
    for (const m of matches) {
      const prev = doneByRound.get(m.round);
      const isDone = m.status === "completed";
      doneByRound.set(m.round, prev === undefined ? isDone : prev && isDone);
    }
    const initial = new Set<number>();
    for (const [round, done] of doneByRound) if (done) initial.add(round);
    return initial;
  });

  const toggleRound = useCallback((round: number) => {
    setCollapsedRounds(prev => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round); else next.add(round);
      return next;
    });
  }, []);

  // Standings per group, memoised so they don't recompute on every keystroke
  const standingsByGroup = useMemo(() =>
    groupNums.map((gNum) => ({
      gNum,
      standings: computeGroupStandings(matches.filter((m) => m.groupNum === gNum)),
    })),
    [groupNums, matches],
  );

  // Visible standings (left panel)
  const visibleStandings = selectedGroup === "all"
    ? standingsByGroup
    : standingsByGroup.filter((s) => s.gNum === selectedGroup);

  // Filtered matches (right panel)
  const visibleMatches = useMemo(() => {
    let ms = selectedGroup === "all" ? matches : matches.filter((m) => m.groupNum === selectedGroup);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      ms = ms.filter((m) =>
        teams[m.home_team_id ?? ""]?.name.toLowerCase().includes(q) ||
        teams[m.away_team_id ?? ""]?.name.toLowerCase().includes(q),
      );
    }
    return ms;
  }, [matches, selectedGroup, search, teams]);

  const byRound = useMemo(() => {
    const map = new Map<number, GroupMatchRow[]>();
    for (const m of visibleMatches) {
      if (!map.has(m.round)) map.set(m.round, []);
      map.get(m.round)!.push(m);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [visibleMatches]);

  const showGroupBadge = selectedGroup === "all";

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-4 lg:items-start">

      {/* ── Left: Standings ──────────────────────────────────────────────── */}
      <div className="lg:col-span-1 space-y-4">
        {/* Group filter tabs */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSelectedGroup("all")}
            className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
              selectedGroup === "all"
                ? "border-indigo-500 bg-indigo-900/50 text-white"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            All
          </button>
          {groupNums.map((gNum) => (
            <button
              key={gNum}
              onClick={() => setSelectedGroup(gNum)}
              className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                selectedGroup === gNum
                  ? "border-indigo-500 bg-indigo-900/50 text-white"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              Group {gNum}
            </button>
          ))}
        </div>

        {/* Standings card(s) */}
        {visibleStandings.map(({ gNum, standings }) => (
          <div key={gNum} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-400">Group {gNum}</p>
            </div>
            <div className="p-3">
              <StandingsTable standings={standings} teams={teams} qualifiersPerGroup={qualifiersPerGroup} topDirectQualifiers={topDirectQualifiers} teamTitles={teamTitles} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Right: Matches ───────────────────────────────────────────────── */}
      <div className="lg:col-span-3 min-w-0 space-y-4">
        {/* Search bar */}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />

        {byRound.length === 0 && (
          <p className="text-zinc-500 text-sm">No matches found.</p>
        )}

        {byRound.map(([round, roundMatches]) => (
          <div key={round} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleRound(round)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 text-left"
            >
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Round {round}</p>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`text-zinc-600 transition-transform duration-150 ${collapsedRounds.has(round) ? "-rotate-90" : "rotate-0"}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {!collapsedRounds.has(round) && <div className="p-3 space-y-1.5">
              {roundMatches.map((m, idx) => {
                const done = m.status === "completed";
                const homeWon = done && (m.home_score ?? 0) > (m.away_score ?? 0);
                const awayWon = done && (m.away_score ?? 0) > (m.home_score ?? 0);
                return (
                  <div
                    key={m.id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border text-xs ${
                      idx % 2 === 0
                        ? "border-zinc-700 bg-zinc-800"
                        : "border-zinc-700 bg-zinc-900"
                    }`}
                  >
                    {/* Optional group badge */}
                    {showGroupBadge && (
                      <span className="shrink-0 text-[9px] font-bold text-zinc-500 uppercase w-6">
                        G{m.groupNum}
                      </span>
                    )}
                    <div className={`flex-1 min-w-0 flex items-center gap-1 font-medium ${
                      !done ? "text-zinc-300" : homeWon ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {teams[m.home_team_id ?? ""]?.logo_url ? (
                        <img src={teams[m.home_team_id ?? ""].logo_url!} alt="" className="w-3.5 h-3.5 rounded shrink-0 object-cover" />
                      ) : null}
                      <span className="truncate">{teams[m.home_team_id ?? ""]?.name ?? "?"}</span>
                    </div>
                    {done ? (
                      <span className="shrink-0 font-mono font-bold text-white text-[11px] tabular-nums px-1">
                        {m.home_score} – {m.away_score}
                      </span>
                    ) : (
                      <span className="shrink-0 text-zinc-600 px-2">vs</span>
                    )}
                    <div className={`flex-1 min-w-0 flex items-center justify-end gap-1 font-medium ${
                      !done ? "text-zinc-300" : awayWon ? "text-emerald-400" : "text-red-400"
                    }`}>
                      <span className="truncate">{teams[m.away_team_id ?? ""]?.name ?? "?"}</span>
                      {teams[m.away_team_id ?? ""]?.logo_url ? (
                        <img src={teams[m.away_team_id ?? ""].logo_url!} alt="" className="w-3.5 h-3.5 rounded shrink-0 object-cover" />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StandingsTable({
  standings,
  teams,
  qualifiersPerGroup,
  topDirectQualifiers,
  teamTitles,
}: {
  standings: GroupStanding[];
  teams: Record<string, GroupTeam>;
  qualifiersPerGroup: number;
  topDirectQualifiers: number;
  teamTitles: Record<string, string>;
}) {
  const hasSecondTier = topDirectQualifiers < qualifiersPerGroup;

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
            <th className="text-left pb-1.5 pr-1 w-5">#</th>
            <th className="text-left pb-1.5">Team</th>
            <th className="text-right pb-1.5 px-1">W</th>
            <th className="text-right pb-1.5 px-1">L</th>
            <th className="text-right pb-1.5 px-1">GD</th>
            <th className="text-right pb-1.5">GF</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, rank) => {
            const isDirect = rank < topDirectQualifiers;
            const isSecond = !isDirect && rank < qualifiersPerGroup;
            const nameColor = isDirect ? "text-emerald-400" : isSecond ? "text-amber-400" : "";
            return (
              <tr key={s.teamId} className="text-zinc-400">
                <td className="py-0.5 pr-1 text-zinc-600 tabular-nums">{rank + 1}</td>
                <td className={`py-0.5 font-medium ${nameColor}`}>
                  <div className="flex items-center gap-1">
                    {teams[s.teamId]?.logo_url ? (
                      <img src={teams[s.teamId].logo_url!} alt="" className="w-4 h-4 rounded shrink-0 object-cover" />
                    ) : (
                      <div className="w-4 h-4 rounded shrink-0 bg-zinc-800 border border-zinc-700/50" />
                    )}
                    <a
                      href={`/dashboard/teams?search=${encodeURIComponent(teams[s.teamId]?.name ?? "")}&from=season`}
                      title={teamTitles[s.teamId]}
                      className="hover:underline"
                    >
                      {teams[s.teamId]?.name ?? "—"}
                    </a>
                  </div>
                </td>
                <td className="py-0.5 text-right px-1 tabular-nums text-emerald-400">{s.wins}</td>
                <td className="py-0.5 text-right px-1 tabular-nums text-red-400">{s.losses}</td>
                <td className={`py-0.5 text-right px-1 tabular-nums ${s.goalDiff < 0 ? "text-red-400" : s.goalDiff > 0 ? "text-emerald-400" : ""}`}>
                  {s.goalDiff > 0 ? `+${s.goalDiff}` : s.goalDiff}
                </td>
                <td className="py-0.5 text-right tabular-nums">{s.goalsFor}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasSecondTier && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-800">
          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            Advances (direct)
          </span>
          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            Advances (Swiss)
          </span>
        </div>
      )}
    </div>
  );
}
