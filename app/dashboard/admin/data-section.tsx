import { supabaseAdmin } from "@/app/lib/supabase";
import { playerRatingFromRow, resolveTeamRating } from "@/app/lib/rating";
import { aggregatePlayerGameStats, type StatAggregationInput } from "@/app/lib/player-stat-aggregation";
import { TAB_LABELS } from "@/app/lib/tab-labels";
import { AdminSubSection } from "./admin-sub-section";

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

export function RegistrationFunnelSection({ analyticsRows }: { analyticsRows: { type: string }[] }) {
  let visits = 0, registrations = 0, draftJoins = 0;
  for (const e of analyticsRows) {
    if (e.type === "visit") visits++;
    else if (e.type === "registration") registrations++;
    else if (e.type === "draft_join") draftJoins++;
  }
  const regRate = visits > 0 ? (registrations / visits) * 100 : 0;
  const draftRate = registrations > 0 ? (draftJoins / registrations) * 100 : 0;

  return (
    <AdminSubSection
      sectionId="data"
      tabId="funnel"
      title="Registration Funnel"
      isDefaultTab
      description="How visitors convert into registered players, and how many registered players go on to enter a draft, over the last 52 tracked weeks."
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Visits" value={visits} />
        <StatCard label="Registrations" value={registrations} sub={`${regRate.toFixed(1)}% of visits`} />
        <StatCard label="Draft Joins" value={draftJoins} sub={`${draftRate.toFixed(1)}% of registrations`} />
      </div>
    </AdminSubSection>
  );
}

export async function CompetitiveSnapshotSection() {
  const [{ data: teams }, { data: rosterPlayers }, { count: completedMatches }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, season_rating"),
    supabaseAdmin
      .from("players")
      .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .eq("status", "approved"),
    supabaseAdmin.from("matches").select("id", { count: "exact", head: true }).eq("status", "completed"),
  ]);

  const ratingsByTeam: Record<string, number[]> = {};
  for (const p of rosterPlayers ?? []) {
    if (!p.team_id) continue;
    (ratingsByTeam[p.team_id] ??= []).push(playerRatingFromRow(p));
  }

  const teamRatings = (teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    rating: resolveTeamRating(t.season_rating != null ? Number(t.season_rating) : null, ratingsByTeam[t.id] ?? []),
  }));

  const topTeam = teamRatings.length ? teamRatings.reduce((a, b) => (b.rating > a.rating ? b : a)) : null;
  const spread =
    teamRatings.length > 1
      ? Math.max(...teamRatings.map((t) => t.rating)) - Math.min(...teamRatings.map((t) => t.rating))
      : 0;

  return (
    <AdminSubSection
      sectionId="data"
      tabId="competitive"
      title="Competitive Snapshot"
      description="Live team ratings under the crl-final-rating-v1 model, and how many matches have been completed so far."
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Teams" value={teamRatings.length} />
        <StatCard label="Completed Matches" value={completedMatches ?? 0} />
        <StatCard label="Top Team" value={topTeam?.name ?? "—"} sub={topTeam ? `${Math.round(topTeam.rating)} rating` : undefined} />
        <StatCard label="Rating Spread" value={Math.round(spread)} sub="max − min live rating" />
      </div>
    </AdminSubSection>
  );
}

type StatKey = "totalGoals" | "totalAssists" | "totalSaves" | "totalShots";
const STAT_CATEGORIES: { label: string; stat: StatKey }[] = [
  { label: "Goals", stat: "totalGoals" },
  { label: "Assists", stat: "totalAssists" },
  { label: "Saves", stat: "totalSaves" },
  { label: "Shots", stat: "totalShots" },
];

export async function StatLeadersSection() {
  const [{ data: statsRaw }, { data: playersRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("player_game_stats")
      .select("player_id, goals, assists, saves, shots, score")
      .not("player_id", "is", null),
    supabaseAdmin.from("players").select("id, username, display_name, team_id").eq("status", "approved"),
    supabaseAdmin.from("teams").select("id, name"),
  ]);

  const teamNames = Object.fromEntries((teamsRaw ?? []).map((t) => [t.id, t.name]));
  const playerMap = Object.fromEntries((playersRaw ?? []).map((p) => [p.id, p]));

  const inputs: StatAggregationInput[] = (statsRaw ?? [])
    .filter((r) => r.player_id && playerMap[r.player_id])
    .map((r) => {
      const player = playerMap[r.player_id];
      return {
        key: r.player_id,
        username: player.username,
        displayName: player.display_name ?? null,
        teamName: player.team_id ? (teamNames[player.team_id] ?? null) : null,
        goals: r.goals, assists: r.assists, saves: r.saves, shots: r.shots, score: r.score,
      };
    });
  const rows = aggregatePlayerGameStats(inputs);

  function top3(stat: StatKey) {
    return [...rows].sort((a, b) => b[stat] - a[stat]).slice(0, 3);
  }

  return (
    <AdminSubSection
      sectionId="data"
      tabId="leaders"
      title="Stat Leaders"
      description="Top 3 players in each core scoreboard stat, aggregated across every submitted replay."
    >
      <div className="grid sm:grid-cols-2 gap-4">
        {STAT_CATEGORIES.map((c) => {
          const leaders = top3(c.stat);
          return (
            <div key={c.stat} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{c.label}</p>
              {leaders.length === 0 ? (
                <p className="text-sm text-zinc-600">No data yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {leaders.map((r, i) => (
                    <div key={r.playerId} className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-600 w-4">{i + 1}.</span>
                      <span className="flex-1 text-white">{r.displayName ?? r.username}</span>
                      <span className="text-zinc-400 font-mono">{r[c.stat]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AdminSubSection>
  );
}

type SummaryShape = { champion?: string | null; runnerUp?: string | null } | null;
type SeasonHistoryRow = { id: string; name: string; champion: string | null; runnerUp: string | null; date: string | null };

export function SeasonHistorySection({
  tournaments,
  seasons,
}: {
  tournaments: { id: string; name: string; status: string; summary: unknown; ended_at: string | null }[];
  seasons: { id: string; name: string; summary: unknown; ended_at: string | null; created_at: string | null }[];
}) {
  const rows: SeasonHistoryRow[] = [
    ...tournaments
      .filter((t) => t.status === "completed")
      .map((t) => {
        const s = t.summary as SummaryShape;
        return { id: t.id, name: t.name, champion: s?.champion ?? null, runnerUp: s?.runnerUp ?? null, date: t.ended_at };
      }),
    ...seasons.map((s) => {
      const summary = s.summary as SummaryShape;
      return { id: s.id, name: s.name, champion: summary?.champion ?? null, runnerUp: summary?.runnerUp ?? null, date: s.ended_at ?? s.created_at };
    }),
  ].sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));

  return (
    <AdminSubSection
      sectionId="data"
      tabId="history"
      title="Season History"
      value={rows.length}
      description="Every completed season and tournament, with its champion and runner-up."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No completed events yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
              <span className="flex-1 text-sm text-white font-medium">{r.name}</span>
              {r.champion && <span className="text-xs text-amber-400">🏆 {r.champion}</span>}
              {r.runnerUp && <span className="text-xs text-zinc-500">2nd: {r.runnerUp}</span>}
              {r.date && <span className="text-xs text-zinc-600">{new Date(r.date).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}
    </AdminSubSection>
  );
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function TabVisitsSection() {
  const DAYS = 30;
  const since = new Date();
  since.setDate(since.getDate() - (DAYS - 1));
  since.setHours(0, 0, 0, 0);

  const { data: rows } = await supabaseAdmin
    .from("tab_visits")
    .select("tab, created_at")
    .gte("created_at", since.toISOString());

  const days: string[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    days.push(dayKey(d));
  }

  const byTab: Record<string, Record<string, number>> = {};
  for (const tab of Object.keys(TAB_LABELS)) byTab[tab] = Object.fromEntries(days.map((d) => [d, 0]));

  for (const r of rows ?? []) {
    if (!(r.tab in byTab)) continue;
    const key = dayKey(new Date(r.created_at));
    if (key in byTab[r.tab]) byTab[r.tab][key]++;
  }

  const tabRows = Object.entries(TAB_LABELS)
    .map(([tab, label]) => {
      const daily = days.map((d) => byTab[tab][d]);
      return { tab, label, daily, total: daily.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.total - a.total);

  const totalVisits = tabRows.reduce((a, r) => a + r.total, 0);
  const maxDaily = Math.max(1, ...tabRows.flatMap((r) => r.daily));

  return (
    <AdminSubSection
      sectionId="data"
      tabId="tab-visits"
      title="Tab Visits"
      value={totalVisits}
      description="How many times each dashboard tab was visited over the last 30 days, with a day-by-day breakdown."
    >
      <div className="space-y-2">
        {tabRows.map((r) => (
          <div key={r.tab} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5">
            <span className="w-24 shrink-0 text-sm text-white font-medium truncate">{r.label}</span>
            <span className="w-10 shrink-0 text-xs text-zinc-400 font-mono tabular-nums">{r.total}</span>
            <div className="flex-1 flex items-end gap-[2px] h-8">
              {r.daily.map((count, i) => (
                <div
                  key={days[i]}
                  title={`${days[i]}: ${count} visit${count === 1 ? "" : "s"}`}
                  className={`flex-1 rounded-sm ${count > 0 ? "bg-amber-500/70" : "bg-zinc-800"}`}
                  style={{ height: `${Math.max(count > 0 ? 12 : 4, (count / maxDaily) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </AdminSubSection>
  );
}
