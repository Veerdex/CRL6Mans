import { supabaseAdmin } from "@/app/lib/supabase";

export type ReplayAnalysisMode = "loose" | "strict";

export async function getReplayAnalysisMode(): Promise<ReplayAnalysisMode> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("replay_analysis_mode")
    .single();
  return data?.replay_analysis_mode === "strict" ? "strict" : "loose";
}

/**
 * Games in this match whose replay contained a player who resolved to nobody.
 * Keyed by game number; only games with at least one unmatched name appear.
 */
export async function getUnmatchedByGame(matchId: string): Promise<Record<number, string[]>> {
  const { data } = await supabaseAdmin
    .from("replay_identity_certifications")
    .select("game_number, unmatched_names")
    .eq("match_id", matchId);

  const out: Record<number, string[]> = {};
  for (const row of data ?? []) {
    const names = (row.unmatched_names ?? []) as string[];
    if (names.length) out[row.game_number] = names;
  }
  return out;
}

export async function matchHasUnmatchedPlayers(matchId: string): Promise<boolean> {
  return Object.keys(await getUnmatchedByGame(matchId)).length > 0;
}
