import { supabaseAdmin } from "@/app/lib/supabase";

export async function StandingsTable() {
  const [{ data: teams }, { data: matches }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name"),
    supabaseAdmin
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score")
      .eq("status", "completed")
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null),
  ]);

  if (!teams?.length) return null;

  const records: Record<string, { wins: number; losses: number }> = {};
  for (const m of matches ?? []) {
    if (!m.home_team_id || !m.away_team_id || m.home_score === null || m.away_score === null) continue;
    if (!records[m.home_team_id]) records[m.home_team_id] = { wins: 0, losses: 0 };
    if (!records[m.away_team_id]) records[m.away_team_id] = { wins: 0, losses: 0 };
    if (m.home_score > m.away_score) {
      records[m.home_team_id].wins++;
      records[m.away_team_id].losses++;
    } else {
      records[m.away_team_id].wins++;
      records[m.home_team_id].losses++;
    }
  }

  const withRecord = teams.map(t => ({
    ...t,
    wins: records[t.id]?.wins ?? 0,
    losses: records[t.id]?.losses ?? 0,
    gp: (records[t.id]?.wins ?? 0) + (records[t.id]?.losses ?? 0),
  }));

  const hasAnyGames = withRecord.some(t => t.gp > 0);
  if (!hasAnyGames) return null;

  const sorted = [...withRecord].sort((a, b) =>
    b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name)
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 w-8">#</th>
            <th className="text-left px-4 py-2.5">Team</th>
            <th className="text-center px-3 py-2.5 w-12">W</th>
            <th className="text-center px-3 py-2.5 w-12">L</th>
            <th className="text-center px-3 py-2.5 w-12">GP</th>
            <th className="text-right px-4 py-2.5 w-16">Win %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sorted.map((team, i) => {
            const winPct = team.gp > 0 ? (team.wins / team.gp) * 100 : 0;
            const isFirst = i === 0;
            return (
              <tr key={team.id} className={`${isFirst ? "bg-amber-900/10" : ""}`}>
                <td className="px-4 py-3 text-zinc-500 tabular-nums text-xs">
                  {isFirst ? "🥇" : i + 1}
                </td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${isFirst ? "text-amber-300" : "text-white"}`}>
                    {team.name}
                  </span>
                </td>
                <td className="px-3 py-3 text-center font-semibold text-emerald-400 tabular-nums">
                  {team.wins}
                </td>
                <td className="px-3 py-3 text-center font-semibold text-red-400 tabular-nums">
                  {team.losses}
                </td>
                <td className="px-3 py-3 text-center text-zinc-400 tabular-nums">
                  {team.gp}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${winPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-400 tabular-nums w-9 text-right">
                      {winPct.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
