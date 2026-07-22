type Team = { id: string; name: string; logo_url: string | null };

export type OverviewMatch = {
  id: string;
  stage: string;
  round: number;
  match_number: number;
  status: string;
  home_team_id: string;
  away_team_id: string;
  homeWinProb: number;
  awayWinProb: number;
};

function stageShort(stage: string): string {
  if (stage.startsWith("group_")) return `G${stage.split("_")[1]}`;
  const map: Record<string, string> = {
    swiss: "SW",
    hybrid_ub: "UB", hybrid8_ub: "UB",
    hybrid_lb: "LB", hybrid8_lb: "LB",
    hybrid_sf: "SF", hybrid8_sf: "SF",
    hybrid_gf: "GF", hybrid8_gf: "GF",
    single_elimination: "SE",
    de_winners: "WB", de_losers: "LB",
    de_grand_final: "GF",
  };
  return map[stage] ?? stage.slice(0, 4).toUpperCase();
}

function matchBadge(stage: string, round: number, mn: number): string {
  const s = stageShort(stage);
  if (s === "GF") return "GF";
  return `${s} R${round}M${mn}`;
}

export function MatchOverviewGrid({
  matches, teams, wagerTotals, bettableMatchIds, onSelectMatch,
}: {
  matches: OverviewMatch[];
  teams: Record<string, Team>;
  wagerTotals: Record<string, { home: number; away: number }>;
  bettableMatchIds: Set<string>;
  onSelectMatch: (matchId: string) => void;
}) {
  if (!matches.length) {
    return (
      <div className="p-6">
        <p className="text-zinc-500 text-sm">No matches yet.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {matches.map((m) => {
          const home = teams[m.home_team_id];
          const away = teams[m.away_team_id];
          const totals = wagerTotals[m.id] ?? { home: 0, away: 0 };
          const homePct = Math.round(m.homeWinProb * 100);
          const awayPct = Math.round(m.awayWinProb * 100);
          const badge = matchBadge(m.stage, m.round, m.match_number);
          const isFinal = m.status === "completed";
          const isBettable = bettableMatchIds.has(m.id);

          const cardBody = (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">{badge}</span>
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    isFinal ? "bg-zinc-700/50 text-zinc-400" : "bg-emerald-500/20 text-emerald-400"
                  }`}
                >
                  {isFinal ? "Final" : "Upcoming"}
                </span>
              </div>

              <TeamRow team={home} pct={homePct} wagered={totals.home} />
              <TeamRow team={away} pct={awayPct} wagered={totals.away} />
            </>
          );

          if (!isBettable) {
            return (
              <div key={m.id} className="text-left bg-zinc-900 border border-zinc-800 rounded-xl p-4 cursor-default">
                {cardBody}
              </div>
            );
          }

          return (
            <button
              key={m.id}
              onClick={() => onSelectMatch(m.id)}
              className="text-left bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition-colors"
            >
              {cardBody}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamRow({ team, pct, wagered }: { team: Team | undefined; pct: number; wagered: number }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {team?.logo_url ? (
        <img src={team.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-zinc-800 shrink-0" />
      )}
      <span className="text-sm font-semibold text-zinc-200 truncate flex-1">{team?.name ?? "?"}</span>
      <span className="text-sm font-bold text-amber-400 tabular-nums">{pct}%</span>
      <span className="text-xs text-zinc-500 tabular-nums w-16 text-right">🪙 {wagered.toLocaleString()}</span>
    </div>
  );
}
