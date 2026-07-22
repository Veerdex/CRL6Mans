import { supabaseAdmin } from "./supabase";
import { getTier } from "./discord-bot";
import { computeMatchPrediction, computeMatchPredictionFromRating } from "@/app/dashboard/wagers/prediction";

const BEST_OF_DEFAULTS: Record<string, number> = {
  standard: 3,
  quarterfinals: 3,
  semifinals: 3,
  finals: 3,
};

function rvOf(p: {
  peak_2v2: string | null;
  current_2v2: string | null;
  peak_3v3: string | null;
  current_3v3: string | null;
}): number {
  return (
    (Number(p.peak_2v2 ?? 0) + Number(p.current_2v2 ?? 0)) * 0.3 +
    (Number(p.peak_3v3 ?? 0) + Number(p.current_3v3 ?? 0)) * 0.2
  );
}

// Freezes the win% shown in the wagers "all matches" grid the moment both teams
// are known for a match — run from the per-minute tournament-scheduler cron so
// it happens shortly after match creation, well before the match is ever played.
// This is deliberately NOT run from the wagers page render path: freezing on
// first view would capture whatever the team rating happens to be at that
// moment, which drifts to a post-game value for matches nobody viewed the grid
// for until after they were reported.
export async function freezeUnfrozenMatchPredictions(): Promise<void> {
  const [{ data: ls }, { data: allMatches }] = await Promise.all([
    supabaseAdmin.from("league_settings").select("season_format").single(),
    supabaseAdmin
      .from("matches")
      .select("id, stage, round, status, home_team_id, away_team_id, predicted_home_win_prob, predicted_away_win_prob")
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null),
  ]);

  // A completed match's rating already reflects that match's own result, so
  // freezing it here would capture a post-game value, not the pre-game one the
  // grid is supposed to show. Only matches still in progress have a legitimate
  // "before" rating to freeze; already-completed matches are backfilled
  // separately (see scripts/backfill-match-predictions.mjs).
  const unfrozen = (allMatches ?? []).filter(
    (m) => m.status !== "completed" && (m.predicted_home_win_prob == null || m.predicted_away_win_prob == null),
  );
  if (!unfrozen.length) return;

  const maxRoundByStage: Record<string, number> = {};
  for (const m of allMatches ?? []) {
    if (!m.stage) continue;
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  }

  const format = ls?.season_format as
    | { roundBestOf?: Record<string, number>; best_of?: number }
    | null;
  const roundBestOf = format?.roundBestOf ?? {};

  function bestOfForMatch(m: { stage: string | null; round: number }): number {
    let bestOf = format?.best_of ?? 3;
    if (m.stage?.startsWith("hybrid")) {
      bestOf = 7;
    } else if (m.stage) {
      const maxRound = maxRoundByStage[m.stage] ?? m.round;
      const tier = getTier(m.round, maxRound);
      bestOf = roundBestOf[tier] ?? BEST_OF_DEFAULTS[tier] ?? format?.best_of ?? 3;
    }
    return bestOf;
  }

  const teamIds = [...new Set(unfrozen.flatMap((m) => [m.home_team_id as string, m.away_team_id as string]))];

  const [{ data: teamsData }, { data: rosterPlayers }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, season_rating").in("id", teamIds),
    supabaseAdmin
      .from("players")
      .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .in("team_id", teamIds)
      .eq("status", "approved"),
  ]);

  const seasonRatings: Record<string, number | null> = {};
  for (const t of teamsData ?? []) {
    seasonRatings[t.id] = t.season_rating != null ? Number(t.season_rating) : null;
  }

  const rvsByTeam: Record<string, number[]> = {};
  for (const p of rosterPlayers ?? []) {
    if (!p.team_id) continue;
    (rvsByTeam[p.team_id] ??= []).push(rvOf(p));
  }

  await Promise.all(
    unfrozen.map((m) => {
      const homeTeamId = m.home_team_id as string;
      const awayTeamId = m.away_team_id as string;
      const bestOf = bestOfForMatch(m);
      const hRating = seasonRatings[homeTeamId];
      const aRating = seasonRatings[awayTeamId];
      const pred =
        hRating != null && aRating != null
          ? computeMatchPredictionFromRating(hRating, aRating, bestOf)
          : computeMatchPrediction(rvsByTeam[homeTeamId] ?? [], rvsByTeam[awayTeamId] ?? [], bestOf);
      return supabaseAdmin
        .from("matches")
        .update({
          predicted_home_win_prob: pred.homeWinProb,
          predicted_away_win_prob: pred.awayWinProb,
        })
        .eq("id", m.id);
    }),
  );
}
