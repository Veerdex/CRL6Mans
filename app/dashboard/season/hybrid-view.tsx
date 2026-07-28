import { supabaseAdmin } from "@/app/lib/supabase";
import { HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF, HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF } from "@/app/lib/bracket";
import { buildTeamTitles } from "@/app/lib/team-titles";
import { HybridBracketDisplay, type TeamMap } from "./hybrid-display";

export async function HybridBracketView({ variant = "12" }: { variant?: "12" | "8" }) {
  const stages = variant === "8"
    ? [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF]
    : [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF];

  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages)
    .order("stage")
    .order("round")
    .order("match_number");

  if (!matches?.length) {
    return <p className="text-zinc-500 text-sm">Hybrid bracket has not been generated yet.</p>;
  }

  const teamIds = [...new Set(
    matches.flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[])
  )];
  const teams: TeamMap = {};
  let teamTitles: Record<string, string> = {};
  if (teamIds.length) {
    const [{ data: teamsData }, { data: playersData }] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name, logo_url").in("id", teamIds),
      supabaseAdmin.from("players").select("team_id, display_name, username, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1").in("team_id", teamIds),
    ]);
    (teamsData ?? []).forEach(t => { teams[t.id] = { name: t.name, logo_url: (t as { logo_url?: string | null }).logo_url ?? null }; });
    teamTitles = buildTeamTitles(playersData ?? []);
  }

  return <HybridBracketDisplay variant={variant} matches={matches} teams={teams} teamTitles={teamTitles} />;
}
