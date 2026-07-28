import { supabaseAdmin } from "./supabase";
import { resolveBestOf, type RoundBestOfConfig, type BestOf } from "@/app/dashboard/season/format-constants";
import { computeMatchPrediction, computeMatchPredictionFromRating } from "@/app/dashboard/wagers/prediction";
import { calculatePlayerRating } from "@/app/lib/rating";

function playerRatingOf(p: {
  peak_2v2: string | null;
  current_2v2: string | null;
  peak_3v3: string | null;
  current_3v3: string | null;
  peak_1v1: string | null;
  current_1v1: string | null;
}): number {
  return calculatePlayerRating({
    at_1v1: Number(p.peak_1v1 ?? 0),
    season_1v1: Number(p.current_1v1 ?? 0),
    at_2v2: Number(p.peak_2v2 ?? 0),
    season_2v2: Number(p.current_2v2 ?? 0),
    at_3v3: Number(p.peak_3v3 ?? 0),
    season_3v3: Number(p.current_3v3 ?? 0),
  });
}

// Freezes the win% shown in the wagers "all matches" grid, and locks in the
// match's betting mode, the moment both teams are known for a match — run
// from the per-minute tournament-scheduler cron so it happens shortly after
// match creation, well before the match is ever played. This is deliberately
// NOT run from the wagers page render path: freezing predictions on first
// view would capture whatever the team rating happens to be at that moment,
// which drifts to a post-game value for matches nobody viewed the grid for
// until after they were reported. Locking betting_mode here (rather than
// only on first bet, in placeBets' lockMatchBettingMode) is what keeps a
// director's later mode toggle from flipping matches that are already
// visible/bettable but haven't had a bet placed yet.
export async function freezeUnfrozenMatchPredictions(): Promise<void> {
  const [{ data: ls }, { data: allMatches }] = await Promise.all([
    supabaseAdmin.from("league_settings").select("season_format, betting_mode").single(),
    supabaseAdmin
      .from("matches")
      .select("id, stage, round, status, home_team_id, away_team_id, predicted_home_win_prob, predicted_away_win_prob, betting_mode")
      .not("home_team_id", "is", null)
      .not("away_team_id", "is", null),
  ]);

  const globalBettingMode: "fixed" | "pool" = ls?.betting_mode === "pool" ? "pool" : "fixed";

  // A completed match's rating already reflects that match's own result, so
  // freezing it here would capture a post-game value, not the pre-game one the
  // grid is supposed to show. Only matches still in progress have a legitimate
  // "before" rating to freeze; already-completed matches are backfilled
  // separately (see scripts/backfill-match-predictions.mjs). Completed matches
  // still get their betting_mode locked, if somehow missing, since that has no
  // such drift concern.
  const needsWork = (allMatches ?? []).filter(
    (m) =>
      m.betting_mode == null ||
      (m.status !== "completed" && (m.predicted_home_win_prob == null || m.predicted_away_win_prob == null)),
  );
  if (!needsWork.length) return;

  const unfrozen = needsWork.filter(
    (m) => m.status !== "completed" && (m.predicted_home_win_prob == null || m.predicted_away_win_prob == null),
  );

  const maxRoundByStage: Record<string, number> = {};
  for (const m of allMatches ?? []) {
    if (!m.stage) continue;
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  }

  const format = ls?.season_format as
    | { roundBestOf?: RoundBestOfConfig; best_of?: number }
    | null;
  const fallbackBestOf = (format?.best_of ?? 3) as BestOf;

  function bestOfForMatch(m: { stage: string | null; round: number }): number {
    if (!m.stage) return fallbackBestOf;
    return resolveBestOf(m.stage, m.round, maxRoundByStage, format?.roundBestOf, fallbackBestOf);
  }

  const teamIds = [...new Set(unfrozen.flatMap((m) => [m.home_team_id as string, m.away_team_id as string]))];

  const [{ data: teamsData }, { data: rosterPlayers }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, season_rating").in("id", teamIds),
    supabaseAdmin
      .from("players")
      .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
      .in("team_id", teamIds)
      .eq("status", "approved"),
  ]);

  const seasonRatings: Record<string, number | null> = {};
  for (const t of teamsData ?? []) {
    seasonRatings[t.id] = t.season_rating != null ? Number(t.season_rating) : null;
  }

  const ratingsByTeam: Record<string, number[]> = {};
  for (const p of rosterPlayers ?? []) {
    if (!p.team_id) continue;
    (ratingsByTeam[p.team_id] ??= []).push(playerRatingOf(p));
  }

  await Promise.all(
    needsWork.map((m) => {
      const update: { betting_mode?: "fixed" | "pool"; predicted_home_win_prob?: number; predicted_away_win_prob?: number } = {};
      if (m.betting_mode == null) update.betting_mode = globalBettingMode;

      const needsPrediction = m.status !== "completed" && (m.predicted_home_win_prob == null || m.predicted_away_win_prob == null);
      if (needsPrediction) {
        const homeTeamId = m.home_team_id as string;
        const awayTeamId = m.away_team_id as string;
        const bestOf = bestOfForMatch(m);
        const hRating = seasonRatings[homeTeamId];
        const aRating = seasonRatings[awayTeamId];
        const pred =
          hRating != null && aRating != null
            ? computeMatchPredictionFromRating(hRating, aRating, bestOf)
            : computeMatchPrediction(ratingsByTeam[homeTeamId] ?? [], ratingsByTeam[awayTeamId] ?? [], bestOf);
        update.predicted_home_win_prob = pred.homeWinProb;
        update.predicted_away_win_prob = pred.awayWinProb;
      }

      return supabaseAdmin.from("matches").update(update).eq("id", m.id);
    }),
  );
}
