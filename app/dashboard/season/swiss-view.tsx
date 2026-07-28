import { supabaseAdmin } from "@/app/lib/supabase";
import { SWISS_STAGE } from "@/app/lib/bracket";
import { buildTeamTitles } from "@/app/lib/team-titles";
import { SwissBracketDisplay, type Team } from "./swiss-display";

export async function SwissBracketView() {
  const [{ data: raw }, { data: teamsRaw }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id,round,match_number,stage,status,home_team_id,away_team_id,home_score,away_score")
      .eq("stage", SWISS_STAGE)
      .order("round").order("match_number"),
    supabaseAdmin.from("teams").select("id,name,logo_url"),
    supabaseAdmin.from("league_settings").select("season_format").single(),
  ]);

  if (!raw?.length) return <p className="text-zinc-500 text-sm">No Swiss matches found.</p>;

  const isHybrid8 = (settings?.season_format as { preset?: string } | null)?.preset === "group_swiss_hybrid_8";

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach(t => { teams[t.id] = t; });

  let teamTitles: Record<string, string> = {};
  const swissTeamIds = [...new Set((raw ?? []).flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[]))];
  if (swissTeamIds.length) {
    const { data: swissPlayers } = await supabaseAdmin
      .from("players")
      .select("team_id, display_name, username, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
      .in("team_id", swissTeamIds);
    teamTitles = buildTeamTitles(swissPlayers ?? []);
  }

  return <SwissBracketDisplay matches={raw} teams={teams} teamTitles={teamTitles} isHybrid8={isHybrid8} />;
}
