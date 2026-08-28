import { supabaseAdmin } from "@/app/lib/supabase";
import { TAB_LABELS } from "@/app/lib/tab-labels";
import { PRESETS } from "@/app/dashboard/season/format-constants";
import type { Tournament, Season } from "./tournament-actions";
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

export function AnalyticsSummaryCards({ analyticsRows }: { analyticsRows: { type: string }[] }) {
  let visits = 0, registrations = 0, draftJoins = 0;
  for (const e of analyticsRows) {
    if (e.type === "visit") visits++;
    else if (e.type === "registration") registrations++;
    else if (e.type === "draft_join") draftJoins++;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <StatCard label="Visits" value={visits} />
      <StatCard label="Registrations" value={registrations} />
      <StatCard label="Draft Joins" value={draftJoins} />
    </div>
  );
}

const PRESET_NAMES: Record<string, string> = Object.fromEntries(PRESETS.map((p) => [p.id, p.name]));

const EVENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Not Started",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

const EVENT_STATUS_COLORS: Record<string, string> = {
  scheduled: "text-zinc-400",
  active: "text-emerald-400",
  completed: "text-blue-400",
  cancelled: "text-red-400",
};

type EventOverviewRow = {
  id: string;
  name: string;
  status: string;
  format: string;
  playerCount: number;
  startedAt: string | null;
  endedAt: string | null;
  sponsorName: string | null;
  champion: string | null;
};

// Completed events carry a full_archive snapshot (teams + rosters) taken right
// before matches/teams get wiped — roster size is the number of players the
// draft actually placed, and stays accurate forever. Events that haven't
// completed yet have no archive, so those fall back to live signup counts.
function archivePlayerCount(fullArchive: unknown): number | null {
  const archive = fullArchive as { teams?: { roster?: unknown[] }[] } | null;
  if (!archive?.teams) return null;
  return archive.teams.reduce((sum, t) => sum + (t.roster?.length ?? 0), 0);
}

function eventFormatName(seasonFormat: unknown, fullArchive: unknown): string {
  const preset =
    (seasonFormat as { preset?: string } | null)?.preset ??
    (fullArchive as { meta?: { formatPreset?: string | null } } | null)?.meta?.formatPreset;
  if (!preset) return "—";
  return PRESET_NAMES[preset] ?? preset;
}

function formatEventDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export async function EventOverviewSection({
  tournaments,
  seasons,
  sponsorNameById,
}: {
  tournaments: Tournament[];
  seasons: Season[];
  sponsorNameById: Map<string, string>;
}) {
  // Only tournaments without an archive yet (not completed) need a live signup
  // count — tournament_entries/team_signup_members rows are never deleted, so
  // this stays accurate for scheduled and active tournaments alike.
  const liveCountIds = tournaments.filter((t) => !t.full_archive).map((t) => t.id);

  const [{ data: entryRows }, { data: teamSignupRows }] = liveCountIds.length
    ? await Promise.all([
        supabaseAdmin.from("tournament_entries").select("tournament_id, player_id").in("tournament_id", liveCountIds),
        supabaseAdmin
          .from("team_signups")
          .select("tournament_id, team_signup_members(player_id)")
          .in("tournament_id", liveCountIds),
      ])
    : [
        { data: [] as { tournament_id: string; player_id: string }[] },
        { data: [] as { tournament_id: string; team_signup_members: { player_id: string }[] }[] },
      ];

  const liveCountByTournament = new Map<string, number>();
  for (const tid of liveCountIds) {
    const ids = new Set<string>();
    for (const r of entryRows ?? []) if (r.tournament_id === tid) ids.add(r.player_id);
    for (const s of teamSignupRows ?? []) {
      if (s.tournament_id !== tid) continue;
      for (const m of s.team_signup_members) ids.add(m.player_id);
    }
    liveCountByTournament.set(tid, ids.size);
  }

  const tournamentRows: EventOverviewRow[] = tournaments.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    format: eventFormatName(t.season_format, t.full_archive),
    playerCount: archivePlayerCount(t.full_archive) ?? liveCountByTournament.get(t.id) ?? 0,
    startedAt: t.started_at,
    endedAt: t.ended_at,
    sponsorName: t.sponsor_id ? (sponsorNameById.get(t.sponsor_id) ?? "Yes") : null,
    champion: t.summary?.champion ?? null,
  }));

  const seasonRows: EventOverviewRow[] = seasons.map((s) => ({
    id: s.id,
    name: s.name,
    status: "completed",
    format: eventFormatName(s.season_format, s.full_archive),
    playerCount: archivePlayerCount(s.full_archive) ?? 0,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    sponsorName: null,
    champion: s.summary?.champion ?? null,
  }));

  const rows = [...tournamentRows, ...seasonRows].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <AdminSubSection
      sectionId="data"
      tabId="event-overview"
      title="Event Overview"
      value={rows.length}
      description="Every tournament and season — format, draft size, schedule, and sponsorship — in one list."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No events yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Event</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Format</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-400 whitespace-nowrap">Players</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Started</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Day</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Ended</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Sponsored</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Champion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-800/40 last:border-b-0 bg-zinc-900/50">
                  <td className="px-4 py-2.5 font-medium text-white whitespace-nowrap">{r.name}</td>
                  <td className={`px-4 py-2.5 whitespace-nowrap ${EVENT_STATUS_COLORS[r.status] ?? "text-zinc-400"}`}>
                    {EVENT_STATUS_LABELS[r.status] ?? r.status}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">{r.format}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300 tabular-nums">{r.playerCount}</td>
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{formatEventDate(r.startedAt)}</td>
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">
                    {r.startedAt ? new Date(r.startedAt).toLocaleDateString(undefined, { weekday: "long" }) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{formatEventDate(r.endedAt)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.sponsorName ? <span className="text-emerald-400">{r.sponsorName}</span> : <span className="text-zinc-600">No</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.champion ? <span className="text-amber-400">🏆 {r.champion}</span> : <span className="text-zinc-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
