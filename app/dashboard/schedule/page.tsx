import { supabaseAdmin } from "@/app/lib/supabase";
import { canonicalStage } from "@/app/dashboard/admin/schedule-utils";
import { ScheduleView, type ScheduleMatch } from "./schedule-view";
import { ScheduleCalendar } from "./schedule-calendar";
import { buildCalEntries, buildPinnedMatchEntries, type PinnedMatch } from "./calendar-entries";
import { SeasonTabs } from "@/app/dashboard/season/season-tabs";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

export default async function SchedulePage() {
  const [{ data: matchRows }, { data: teamsRaw }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, stage, round, match_number, scheduled_at, schedule_accepted, schedule_admin_required, schedule_proposed_by_team_id, admin_scheduled, home_team_id, away_team_id")
      .eq("status", "scheduled")
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null)
      .order("scheduled_at", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name"),
    supabaseAdmin.from("league_settings").select("active_tournament_id").maybeSingle(),
  ]);

  // Rounds with an admin-set *specific* time — only those auto-confirm. Weekly/daily are
  // windows where teams still pick a time, so they must not be treated as locked-in.
  const activeTournamentId = (settings?.active_tournament_id as string | null) ?? null;
  const [{ data: roundScheduleRows }, { data: pinnedMatchRows }] = await Promise.all([
    activeTournamentId
      ? supabaseAdmin.from("round_schedules").select("stage, round, schedule_type, play_at, range_days").eq("tournament_id", activeTournamentId).order("stage").order("round")
      : supabaseAdmin.from("round_schedules").select("stage, round, schedule_type, play_at, range_days").is("tournament_id", null).order("stage").order("round"),
    supabaseAdmin
      .from("matches")
      .select("id, stage, round, match_number, scheduled_at")
      .eq("admin_scheduled", true)
      .not("scheduled_at", "is", null)
      .neq("status", "completed"),
  ]);
  const adminFixedRounds = new Set(
    (roundScheduleRows ?? []).filter((s) => s.schedule_type === "specific").map((s) => `${s.stage}:${s.round}`),
  );

  // Calendar entries (round windows) for the Calendar sub-tab.
  const roundRows = (roundScheduleRows ?? []).map((s) => ({
    stage: s.stage as string,
    round: s.round as number,
    scheduleType: s.schedule_type as string,
    rangeDays: s.range_days as number | null,
    playAt: s.play_at as string,
  }));

  // Admin-pinned individual matches → fixed-time calendar entries.
  const pinnedMatches: PinnedMatch[] = (pinnedMatchRows ?? []).map((m) => ({
    id: m.id as string,
    stage: m.stage as string,
    round: m.round as number,
    matchNumber: m.match_number as number,
    scheduledAt: m.scheduled_at as string,
  }));

  const calEntries = [
    ...buildCalEntries(roundRows),
    ...buildPinnedMatchEntries(pinnedMatches, roundRows),
  ];

  const teamName: Record<string, string> = {};
  teamsRaw?.forEach((t) => { teamName[t.id] = t.name; });

  type Row = {
    id: string; stage: string; round: number; match_number: number;
    scheduled_at: string | null; schedule_accepted: boolean;
    schedule_admin_required: boolean; schedule_proposed_by_team_id: string | null;
    admin_scheduled: boolean;
    home_team_id: string; away_team_id: string;
  };
  const rows = (matchRows ?? []) as Row[];

  // Only show games that are ready to play: both teams have no earlier-round
  // unplayed match in the same stage (hides e.g. group R2/R3 until R1 is done).
  const isReady = (m: Row) =>
    !rows.some(
      (x) =>
        x.stage === m.stage &&
        x.round < m.round &&
        (x.home_team_id === m.home_team_id ||
          x.away_team_id === m.home_team_id ||
          x.home_team_id === m.away_team_id ||
          x.away_team_id === m.away_team_id),
    );

  const matches: ScheduleMatch[] = rows
    .filter(isReady)
    .sort((a, b) => a.round - b.round || a.stage.localeCompare(b.stage) || a.match_number - b.match_number)
    .map((m) => {
      const adminFixed = adminFixedRounds.has(`${canonicalStage(m.stage)}:${m.round}`);
      // Locked in = has a time, not awaiting admin, and either team-accepted, an
      // admin-pinned individual match, or a specific-round default with no pending proposal.
      const confirmed =
        !!m.scheduled_at &&
        !m.schedule_admin_required &&
        (m.schedule_accepted || m.admin_scheduled || (adminFixed && !m.schedule_proposed_by_team_id));
      return {
        id: m.id,
        stage: m.stage,
        round: m.round,
        match_number: m.match_number,
        scheduled_at: m.scheduled_at,
        confirmed,
        home_team_name: teamName[m.home_team_id] ?? "TBD",
        away_team_name: teamName[m.away_team_id] ?? "TBD",
      };
    });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Schedule</h1>
          <SponsoredByLine tabKey="schedule" />
        </div>
        <p className="text-sm text-zinc-500 mt-1">All upcoming matches and their confirmed play times.</p>
      </div>
      <SeasonTabs
        defaultTab="matches"
        tabs={[
          { key: "matches", label: "Matches", content: <ScheduleView matches={matches} /> },
          { key: "calendar", label: "Calendar", content: <ScheduleCalendar entries={calEntries} /> },
        ]}
      />
    </div>
  );
}
