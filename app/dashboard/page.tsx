import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import DraftCard from "./draft-card";
import { TeamSignupPanel } from "./team-signup-panel";
import { TournamentJoinCard } from "./tournament-join-card";
import { getTeamSignupView, type TeamSignupView } from "./team-signup-data";
import { PastEvents, presetLabel, type PastEvent } from "./past-events";
import { LocalTime } from "./local-time";
import { TrackerUpdateBanner } from "./tracker-update-banner";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const [playerRes, settingsRes, draftQueueRes, tournamentsRes, seasonsRes, matchStagesRes] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("id, status, draft_entered, display_name, must_update_tracker")
      .eq("discord_id", session.userId)
      .single(),
    supabaseAdmin.from("league_settings").select("draft_open, draft_active, season_active").single(),
    supabaseAdmin
      .from("players")
      .select("id")
      .eq("status", "approved")
      .eq("draft_entered", true)
      .order("draft_entered_at", { ascending: true, nullsFirst: false }),
    supabaseAdmin
      .from("tournaments")
      .select("id, name, status, signups_open, summary, season_format, ended_at, join_mode, team_assignment, draft_open_at, draft_close_at, draft_start_at, season_start_at, hidden_from_home")
      .in("status", ["scheduled", "active", "completed"])
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("seasons")
      .select("id, name, season_format, team_count, summary, ended_at, created_at, hidden_from_home")
      .order("ended_at", { ascending: false }),
    supabaseAdmin
      .from("matches")
      .select("stage, round, status"),
  ]);

  const player = playerRes.data;
  const settings = settingsRes.data;
  const draftQueue = draftQueueRes.data ?? [];
  const tournaments = tournamentsRes.data ?? [];
  const activeTournament = tournaments.find((t) => t.status === "active") ?? null;
  const pastTournaments = tournaments.filter((t) => t.status === "completed" && !t.hidden_from_home);
  const seasons = (seasonsRes.data ?? []).filter((s) => !s.hidden_from_home);

  type PlayerSnap = { username: string; displayName: string | null };
  type SummaryShape = {
    champion?: string | null;
    runnerUp?: string | null;
    finalStandings?: unknown[];
    championPlayers?: PlayerSnap[];
    runnerUpPlayers?: PlayerSnap[];
  } | null;

  const pastEvents: PastEvent[] = [
    ...pastTournaments.map((t): PastEvent => {
      const summary = t.summary as SummaryShape;
      return {
        id: t.id,
        kind: "tournament",
        name: t.name,
        formatLabel: presetLabel((t.season_format as { preset?: string } | null)?.preset),
        teamCount: summary?.finalStandings?.length ?? null,
        champion: summary?.champion ?? null,
        runnerUp: summary?.runnerUp ?? null,
        championPlayers: summary?.championPlayers ?? [],
        runnerUpPlayers: summary?.runnerUpPlayers ?? [],
        date: t.ended_at ?? null,
      };
    }),
    ...seasons.map((s): PastEvent => {
      const summary = s.summary as SummaryShape;
      return {
        id: s.id,
        kind: "season",
        name: s.name,
        formatLabel: presetLabel((s.season_format as { preset?: string } | null)?.preset),
        teamCount: (s.team_count as number | null) ?? summary?.finalStandings?.length ?? null,
        champion: summary?.champion ?? null,
        runnerUp: summary?.runnerUp ?? null,
        championPlayers: summary?.championPlayers ?? [],
        runnerUpPlayers: summary?.runnerUpPlayers ?? [],
        date: s.ended_at ?? s.created_at ?? null,
      };
    }),
  ]
    .sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0))
    .slice(0, 8);
  const now = Date.now();
  const openTournaments = tournaments.filter((t) => {
    if (t.status !== "scheduled") return false;
    if (t.signups_open) return true;
    return t.draft_open_at && now >= new Date(t.draft_open_at).getTime() && (!t.draft_close_at || now < new Date(t.draft_close_at).getTime());
  });
  const upcomingTournaments = tournaments.filter((t) =>
    t.status === "scheduled" && !openTournaments.includes(t)
  );
  const isApproved = player?.status === "approved";

  // Player-pool joins: which open tournaments I'm in + pool sizes.
  const openPlayerTs = openTournaments.filter((t) => t.join_mode === "players");
  const myEntryIds = new Set<string>();
  const poolCounts: Record<string, number> = {};
  if (openPlayerTs.length) {
    const { data: entries } = await supabaseAdmin
      .from("tournament_entries")
      .select("tournament_id, player_id")
      .in("tournament_id", openPlayerTs.map((t) => t.id));
    for (const e of entries ?? []) {
      poolCounts[e.tournament_id] = (poolCounts[e.tournament_id] ?? 0) + 1;
      if (player?.id && e.player_id === player.id) myEntryIds.add(e.tournament_id);
    }
  }

  // Team-signup views per open team tournament.
  const openTeamTs = openTournaments.filter((t) => t.join_mode === "teams");
  const teamViews: Record<string, TeamSignupView> = {};
  if (isApproved && player?.id) {
    for (const t of openTeamTs) teamViews[t.id] = await getTeamSignupView(player.id, t.id, true);
  }

  const draftCount = draftQueue.length;
  const signupsOpen = (settings?.draft_open ?? false) && !(settings?.draft_active ?? false) && !(settings?.season_active ?? false);
  const inDraft = player?.draft_entered ?? false;

  // Compute current season stage label from active matches.
  const allMatchStages = matchStagesRes.data ?? [];
  const seasonActive = settings?.season_active ?? false;
  const currentSeasonLabel = seasonActive ? computeSeasonStageLabel(allMatchStages) : null;
  const seasonEventName = activeTournament?.name ?? "Season";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-1">Welcome back, {player?.display_name ?? session.username}</p>
      </div>

      {player?.must_update_tracker && <TrackerUpdateBanner />}

      <a
        href="https://crl6mans-queue-bot.vercel.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-700 transition-colors"
      >
        <span className="text-sm font-semibold text-white">6 Mans Queue Leaderboard</span>
        <span className="text-zinc-500">↗</span>
      </a>

      {activeTournament && (
        <div className="bg-gradient-to-br from-indigo-950/40 to-zinc-900 border border-indigo-800/40 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Active Tournament</p>
          </div>
          <h2 className="text-xl font-bold text-white mt-1">{activeTournament.name}</h2>
          {seasonActive && currentSeasonLabel ? (
            <p className="text-sm text-indigo-300 mt-1">{currentSeasonLabel}</p>
          ) : (
            <div className="text-xs text-zinc-400 mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
              {activeTournament.draft_start_at && <span>Draft: <LocalTime iso={activeTournament.draft_start_at} /></span>}
              {activeTournament.season_start_at && <span>Tournament: <LocalTime iso={activeTournament.season_start_at} /></span>}
            </div>
          )}
        </div>
      )}

      {/* Season draft block */}
      {isApproved && activeTournament?.join_mode !== "teams" && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Season</h2>
          {seasonActive ? (
            <div className="bg-gradient-to-br from-indigo-950/40 to-zinc-900 border border-indigo-800/40 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Season Active</p>
              </div>
              <h2 className="text-xl font-bold text-white">{seasonEventName}</h2>
              {currentSeasonLabel && (
                <p className="text-sm text-indigo-300 mt-1">{currentSeasonLabel}</p>
              )}
            </div>
          ) : (
            <>
              <DraftCard
                inDraft={inDraft}
                draftCount={draftCount}
                signupsOpen={signupsOpen}
                draftActive={settings?.draft_active ?? false}
                seasonActive={false}
              />
              <Stat label="Draft pool" value={draftCount} />
            </>
          )}
        </div>
      )}

      {/* Open tournaments you can join */}
      {isApproved && openTournaments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Open Tournaments</h2>
          {openPlayerTs.map((t) => (
            <TournamentJoinCard
              key={t.id}
              id={t.id}
              name={t.name}
              poolCount={poolCounts[t.id] ?? 0}
              joined={myEntryIds.has(t.id)}
              teamAssignment={t.team_assignment as "snake_draft" | "auto_balance" | null}
              timeline={buildTimeline(t)}
              minMmr2v2={(t as { min_mmr_2v2?: number | null }).min_mmr_2v2 ?? null}
              minMmr3v3={(t as { min_mmr_3v3?: number | null }).min_mmr_3v3 ?? null}
            />
          ))}
          {openTeamTs.map((t) =>
            teamViews[t.id] ? (
              <TeamSignupPanel
                key={t.id}
                view={teamViews[t.id]}
                tournamentId={t.id}
                tournamentName={t.name}
                timeline={buildTimeline(t)}
              />
            ) : null
          )}
        </div>
      )}

      {/* Upcoming tournaments (not yet open) */}
      {upcomingTournaments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Upcoming Tournaments</h2>
          {upcomingTournaments.map((t) => {
            const items = buildTimeline(t, true);
            return (
              <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 space-y-2">
                <p className="text-sm font-semibold text-white">{t.name}</p>
                {items.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {items.map(({ label, iso }) => (
                      <span key={label} className="text-xs text-zinc-500">
                        {label}: <LocalTime iso={iso} className="text-zinc-400" />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <PastEvents events={pastEvents} />
    </div>
  );
}

type TournamentRow = {
  join_mode: string;
  team_assignment: string | null;
  draft_open_at: string | null;
  draft_close_at: string | null;
  draft_start_at: string | null;
  season_start_at: string | null;
};

function buildTimeline(t: TournamentRow, showOpen = false): { label: string; iso: string }[] {
  const isAuto = t.team_assignment === "auto_balance";
  return [
    ...(showOpen && t.draft_open_at ? [{ label: "Sign-ups open", iso: t.draft_open_at }] : []),
    ...(t.draft_close_at ? [{ label: "Sign-ups close", iso: t.draft_close_at }] : []),
    ...(t.join_mode === "players" && t.draft_start_at
      ? [{ label: isAuto ? "Auto-balance executes" : "Draft starts", iso: t.draft_start_at }]
      : []),
    ...(t.season_start_at ? [{ label: "Tournament starts", iso: t.season_start_at }] : []),
  ];
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}

type MatchStageRow = { stage: string | null; round: number | null; status: string | null };

function computeSeasonStageLabel(matches: MatchStageRow[]): string | null {
  if (!matches.length) return null;

  // Prefer scheduled matches; fall back to completed to show the last active stage.
  const scheduled = matches.filter((m) => m.status === "scheduled" && m.stage && m.round != null);
  const pool = scheduled.length ? scheduled : matches.filter((m) => m.stage && m.round != null);
  if (!pool.length) return null;

  // Current stage = the one with the most matches in the pool.
  const stageCounts: Record<string, number> = {};
  for (const m of pool) if (m.stage) stageCounts[m.stage] = (stageCounts[m.stage] ?? 0) + 1;
  const currentStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!currentStage) return null;

  const stageMatches = pool.filter((m) => m.stage === currentStage);
  const currentRound = Math.max(...stageMatches.map((m) => m.round ?? 0));

  // Max round ever seen for this stage (for SE tier labeling).
  const allForStage = matches.filter((m) => m.stage === currentStage);
  const maxRound = Math.max(...allForStage.map((m) => m.round ?? 0));

  return stageLabel(currentStage, currentRound, maxRound);
}

function stageLabel(stage: string, round: number, maxRound: number): string {
  if (stage.startsWith("group_")) return `Group Stage, Round ${round}`;
  if (stage === "swiss") return `Swiss, Round ${round}`;
  if (stage === "single_elimination") return `Single Elimination — ${seTierLabel(round, maxRound)}`;
  if (stage === "de_winners") return `Winners Bracket, Round ${round}`;
  if (stage === "de_losers") return `Losers Bracket, Round ${round}`;
  if (stage === "de_grand_final") return "Grand Final";
  if (stage === "hybrid_ub" || stage === "hybrid8_ub") return `Upper Bracket, Round ${round}`;
  if (stage === "hybrid_lb" || stage === "hybrid8_lb") return `Lower Bracket, Round ${round}`;
  if (stage === "hybrid_sf" || stage === "hybrid8_sf") return "Semi Finals";
  if (stage === "hybrid_gf" || stage === "hybrid8_gf") return "Grand Final";
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function seTierLabel(round: number, maxRound: number): string {
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return "Finals";
  if (fromFinal === 1) return "Semi Finals";
  if (fromFinal === 2) return "Quarter Finals";
  return `Round ${round}`;
}
