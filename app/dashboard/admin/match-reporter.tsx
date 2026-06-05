"use client";

import { useState, useTransition } from "react";
import { reportMatchResult } from "./match-actions";

type MatchData = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  stage: string;
  round: number;
  matchNumber: number;
  scheduledAt: string | null;
  scheduleAccepted: boolean;
};

const STAGE_ORDER: Record<string, number> = {
  group_1: 0, group_2: 1, group_3: 2, group_4: 3, group_5: 4,
  group_6: 5, group_7: 6, group_8: 7,
  se_qualifier: 10,
  de_qualifier_winners: 11, de_qualifier_losers: 12,
  swiss: 20,
  single_elimination: 30,
  double_elimination_winners: 31, double_elimination_losers: 32,
  double_elimination_grand_final: 33,
};

function stageSort(a: string, b: string): number {
  const oa = STAGE_ORDER[a] ?? 99;
  const ob = STAGE_ORDER[b] ?? 99;
  return oa - ob || a.localeCompare(b);
}

function stageName(stage: string): string {
  if (stage === "single_elimination") return "Single Elimination";
  if (stage === "double_elimination_winners") return "DE Winners";
  if (stage === "double_elimination_losers") return "DE Losers";
  if (stage === "double_elimination_grand_final") return "Grand Final";
  if (stage === "swiss") return "Swiss";
  if (stage === "se_qualifier") return "SE Qualifier";
  if (stage === "de_qualifier_winners") return "DEQ Winners";
  if (stage === "de_qualifier_losers") return "DEQ Losers";
  const gm = stage.match(/^group_(\d+)$/);
  if (gm) return `Group ${gm[1]}`;
  return stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function MatchEntry({ match, onReported }: { match: MatchData; onReported: (id: string, summary: string) => void }) {
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const h = parseInt(homeScore);
    const a = parseInt(awayScore);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) { setError("Enter valid scores."); return; }
    if (h === a) { setError("Scores can't be equal."); return; }
    setError(null);
    startTransition(async () => {
      const res = await reportMatchResult(match.id, h, a);
      if (!res.ok) { setError(res.message); return; }
      onReported(match.id, res.message);
    });
  }

  const scheduleLabel = match.scheduledAt
    ? new Date(match.scheduledAt).toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      })
    : null;

  return (
    <div className="px-4 py-3 border-b border-zinc-800/60 last:border-0 space-y-1.5">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold text-zinc-500 w-16 shrink-0 tabular-nums">
          R{match.round} M{match.matchNumber}
        </span>

        <span className="flex-1 text-sm font-medium text-white text-right truncate">{match.homeTeamName}</span>

        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number" min={0} max={9} value={homeScore}
            onChange={e => setHomeScore(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="—"
            className="w-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
          />
          <span className="text-zinc-600 text-sm">–</span>
          <input
            type="number" min={0} max={9} value={awayScore}
            onChange={e => setAwayScore(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="—"
            className="w-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
          />
        </div>

        <span className="flex-1 text-sm font-medium text-white truncate">{match.awayTeamName}</span>

        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={submit}
            disabled={isPending || !homeScore || !awayScore}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
          >
            {isPending ? "Saving…" : "Submit"}
          </button>
        </div>
      </div>

      {scheduleLabel && (
        <p className={`text-[10px] pl-20 ${match.scheduleAccepted ? "text-emerald-400" : "text-amber-400"}`}>
          {match.scheduleAccepted ? "✅" : "📅"} {scheduleLabel}
          {!match.scheduleAccepted && <span className="text-zinc-600 ml-1">· pending acceptance</span>}
        </p>
      )}
    </div>
  );
}

function StageGroup({
  stage, matches, onReported,
}: { stage: string; matches: MatchData[]; onReported: (id: string, summary: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 text-left"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{stageName(stage)}</p>
          <span className="text-[10px] text-zinc-600">{matches.length} match{matches.length !== 1 ? "es" : ""}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`text-zinc-600 transition-transform duration-150 ${collapsed ? "-rotate-90" : "rotate-0"}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && matches.map(m => (
        <MatchEntry key={m.id} match={m} onReported={onReported} />
      ))}
    </div>
  );
}

export function MatchReporter({ matches: initialMatches }: { matches: MatchData[] }) {
  const [pending, setPending] = useState(initialMatches);
  const [reported, setReported] = useState<{ id: string; summary: string }[]>([]);

  function onReported(id: string, summary: string) {
    setPending(ms => ms.filter(m => m.id !== id));
    setReported(rs => [{ id, summary }, ...rs]);
  }

  const byStage = pending.reduce<Record<string, MatchData[]>>((acc, m) => {
    if (!acc[m.stage]) acc[m.stage] = [];
    acc[m.stage].push(m);
    return acc;
  }, {});

  const sortedStages = Object.keys(byStage).sort(stageSort);

  if (pending.length === 0 && reported.length === 0) {
    return <p className="text-sm text-zinc-500">No scheduled matches to report.</p>;
  }

  return (
    <div className="space-y-3">
      {sortedStages.map(stage => (
        <StageGroup key={stage} stage={stage} matches={byStage[stage]} onReported={onReported} />
      ))}

      {reported.length > 0 && (
        <div className="pt-1 space-y-1">
          {reported.map(r => (
            <p key={r.id} className="text-xs text-emerald-400 px-1">✓ {r.summary}</p>
          ))}
        </div>
      )}

      {pending.length === 0 && (
        <p className="text-sm text-zinc-500">All matches reported.</p>
      )}
    </div>
  );
}
