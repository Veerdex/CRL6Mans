import { supabaseAdmin } from "@/app/lib/supabase";
import {
  DE_WINNERS, DE_LOSERS, DE_GF,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
  GROUP_STAGE_PREFIX, parseGroupNum,
} from "@/app/lib/bracket";
import { buildTeamTitles } from "@/app/lib/team-titles";
import { GroupStageClient } from "./group-stage-client";
import { SEBracketDisplay, DEBracketDisplay, DEQualifierBracketDisplay, type Team } from "./bracket-display";

const MATCH_SELECT = "id, round, match_number, stage, status, home_team_id, away_team_id, home_score, away_score";

export async function SEBracketView({ stage = "single_elimination" }: { stage?: string } = {}) {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select(MATCH_SELECT)
      .eq("stage", stage)
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) {
    return <p className="text-zinc-500 text-sm">No bracket matches found.</p>;
  }

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  return <SEBracketDisplay matches={matchesRaw} teams={teams} />;
}

export async function DEBracketView() {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select(MATCH_SELECT)
      .in("stage", [DE_WINNERS, DE_LOSERS, DE_GF])
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) return <p className="text-zinc-500 text-sm">No bracket matches found.</p>;

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  return <DEBracketDisplay matches={matchesRaw} teams={teams} />;
}

export async function DEQualifierBracketView() {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select(MATCH_SELECT)
      .in("stage", [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS])
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) return <p className="text-zinc-500 text-sm">No bracket matches found.</p>;

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  return <DEQualifierBracketDisplay matches={matchesRaw} teams={teams} />;
}

// ── Group Bracket View ────────────────────────────────────────────────────────

export async function GroupBracketView({ qualifiersPerGroup, topDirectQualifiers }: { qualifiersPerGroup: number; topDirectQualifiers?: number }) {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select(MATCH_SELECT)
      .like("stage", `${GROUP_STAGE_PREFIX}%`)
      .order("stage", { ascending: true })
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) return <p className="text-zinc-500 text-sm">No group matches found.</p>;

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  const groupTeamIds = [...new Set(matchesRaw.flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[]))];
  let teamTitles: Record<string, string> = {};
  if (groupTeamIds.length) {
    const { data: groupPlayers } = await supabaseAdmin
      .from("players")
      .select("team_id, display_name, username, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
      .in("team_id", groupTeamIds);
    teamTitles = buildTeamTitles(groupPlayers ?? []);
  }

  const groupNums = [...new Set(matchesRaw.map((m) => parseGroupNum(m.stage)!))].sort((a, b) => a - b);

  // Attach groupNum to each match so the client component doesn't need to re-parse stage strings
  const matches = matchesRaw.map((m) => ({ ...m, groupNum: parseGroupNum(m.stage)! }));

  return (
    <GroupStageClient
      groupNums={groupNums}
      matches={matches}
      teams={teams}
      qualifiersPerGroup={qualifiersPerGroup}
      topDirectQualifiers={topDirectQualifiers ?? qualifiersPerGroup}
      teamTitles={teamTitles}
    />
  );
}
