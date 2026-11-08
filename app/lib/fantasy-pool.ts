// Pure fantasy player-pool math: tiers, series points and projections.
// No Supabase import, so node --test can load it. The rules are
// docs/fantasy-rl.md §3 (tiers) and §5 (scoring); the projection is
// docs/fantasy-projections.md.

import {
  FP_BASELINE_RV,
  HISTORY_PRIOR_GAMES,
  fantasyPoints,
  projectedStatLine,
  type StatLine,
  type StatTotals,
} from "./rv-adjustment";
import { CAPTAIN_DRAFT_ROUND } from "./draft-order";

export type FantasyTier = 1 | 2 | 3;

export const TIER_LABEL: Record<FantasyTier, string> = { 1: "Cap", 2: "1st", 3: "2nd" };

/** A series is scored as this many points per unit of FP. */
export const STAT_POINTS_PER_FP = 20;

/** A drafted player's tier, from the round they were taken in. */
export function tierFromDraftRound(round: number): FantasyTier {
  if (round <= CAPTAIN_DRAFT_ROUND) return 1;
  return round === 1 ? 2 : 3;
}

/**
 * Free agents split into thirds by rating, the cut points taken across every
 * player in the season (drafted and free agents alike), so a free agent's tier
 * says where they rank in the league rather than among the leftovers.
 * `seasonRatings` includes the free agent's own rating.
 */
export function freeAgentTier(rating: number, seasonRatings: number[]): FantasyTier {
  const n = seasonRatings.length;
  if (n === 0) return 3;
  const above = seasonRatings.filter((r) => r > rating).length;
  const share = above / n;
  if (share < 1 / 3) return 1;
  return share < 2 / 3 ? 2 : 3;
}

export type ProjectionBasis = "rating" | "provisional" | "history";

/** docs/fantasy-projections.md §2's labels: how much of a projection is the player's own history. */
export function projectionBasis(games: number): ProjectionBasis {
  const w = games / (games + HISTORY_PRIOR_GAMES);
  if (w === 0) return "rating";
  return w < 0.5 ? "provisional" : "history";
}

/**
 * Projected stat points per series, before the win bonus. `rating` is null for
 * a player with no ranks on file: their history alone if they have any, the
 * league means if they have none.
 */
export function projectedStatPoints(rating: number | null, history: StatTotals | null): number {
  const games = history?.games ?? 0;
  if (rating !== null || games === 0) {
    return STAT_POINTS_PER_FP * fantasyPoints(projectedStatLine(rating ?? FP_BASELINE_RV, games > 0 ? history : null));
  }
  const scoreGames = history!.scoreGames ?? games;
  return STAT_POINTS_PER_FP * fantasyPoints({
    score: scoreGames > 0 ? history!.score / scoreGames : projectedStatLine(FP_BASELINE_RV, null).score,
    goals: history!.goals / games,
    assists: history!.assists / games,
    saves: history!.saves / games,
    shots: history!.shots / games,
  });
}

export type SeriesForScoring = {
  forfeit: boolean;
  /** Games won by the player's own team and by the opponent. */
  ownScore: number;
  oppScore: number;
  /** The player's summed stats over the games they played for their own team. */
  stats: StatLine;
  gamesPlayed: number;
};

/**
 * docs/fantasy-rl.md §5. Stats are divided by the series length, not by games
 * played, and the win bonus is prorated by games played.
 */
export function seriesFantasyPoints(s: SeriesForScoring): number {
  const n = s.ownScore + s.oppScore;
  if (s.forfeit || n === 0 || s.gamesPlayed === 0) return 0;
  const perSeriesGame: StatLine = {
    score: s.stats.score / n,
    goals: s.stats.goals / n,
    assists: s.stats.assists / n,
    saves: s.stats.saves / n,
    shots: s.stats.shots / n,
  };
  const won = s.ownScore > s.oppScore;
  const bonus = won ? s.ownScore - s.oppScore : 0;
  return STAT_POINTS_PER_FP * fantasyPoints(perSeriesGame) + bonus * (s.gamesPlayed / n);
}
