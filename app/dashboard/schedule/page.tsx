import { supabaseAdmin } from "@/app/lib/supabase";
import { ScheduleView, type ScheduleMatch } from "./schedule-view";

export default async function SchedulePage() {
  const [{ data: matchRows }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, stage, round, match_number, scheduled_at, schedule_accepted, home_team_id, away_team_id")
      .eq("status", "scheduled")
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null)
      .order("scheduled_at", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name"),
  ]);

  const teamName: Record<string, string> = {};
  teamsRaw?.forEach((t) => { teamName[t.id] = t.name; });

  type Row = {
    id: string; stage: string; round: number; match_number: number;
    scheduled_at: string | null; schedule_accepted: boolean;
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
    .map((m) => ({
      id: m.id,
      stage: m.stage,
      round: m.round,
      match_number: m.match_number,
      scheduled_at: m.scheduled_at,
      schedule_accepted: m.schedule_accepted,
      home_team_name: teamName[m.home_team_id] ?? "TBD",
      away_team_name: teamName[m.away_team_id] ?? "TBD",
    }));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Schedule</h1>
        <p className="text-sm text-zinc-500 mt-1">All upcoming matches and their confirmed play times.</p>
      </div>
      <ScheduleView matches={matches} />
    </div>
  );
}
