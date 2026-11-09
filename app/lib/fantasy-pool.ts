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
import { PREDICTION_SCALE, predictSeries } from "./rating";

export type FantasyTier = 1 | 2 | 3;

export const TIER_LABEL: Record<FantasyTier, string> = { 1: "Cap", 2: "1st", 3: "2nd" };

/** A player's name colour by tier: Cap gold, 1st soft blue, 2nd orange. */
export const TIER_NAME_CLASS: Record<FantasyTier, string> = { 1: "text-tier-1", 2: "text-tier-2", 3: "text-tier-3" };

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

/**
 * docs/fantasy-projections.md §2's labels: how much stat history stands behind a projection,
 * either through the rating's adjustment or, with no ranks on file, directly.
 */
export function projectionBasis(games: number): ProjectionBasis {
  const w = games / (games + HISTORY_PRIOR_GAMES);
  if (w === 0) return "rating";
  return w < 0.5 ? "provisional" : "history";
}

/** The player's team rating, the opponent's, and the wins the series takes. */
export type Matchup = { ownRating: number; oppRating: number; winsNeeded: number };

/** Stat points are multiplied by this when a team is certain to lose its series, and by MATCHUP_CEILING when certain to win it. */
export const MATCHUP_FLOOR = 0.1;
export const MATCHUP_CEILING = 1.5;
/** How slowly the multiplier leaves 1: a 75% favourite gets 1 + 0.5 × 0.5^1.75 ≈ 1.15. */
const MATCHUP_CURVE = 1.75;

/**
 * A ranked player projects from their rating alone, never blended with their stat history:
 * the rating already carries rv_adjustment, which learns from those same stats, so blending
 * them in again double-counts a hot or cold start (docs/fantasy-projections.md §2 step 2).
 */
function projectedPerGameLine(rating: number | null, history: StatTotals | null): StatLine {
  const games = history?.games ?? 0;
  if (rating !== null || games === 0) return projectedStatLine(rating ?? FP_BASELINE_RV, null);
  const scoreGames = history!.scoreGames ?? games;
  return {
    score: scoreGames > 0 ? history!.score / scoreGames : projectedStatLine(FP_BASELINE_RV, null).score,
    goals: history!.goals / games,
    assists: history!.assists / games,
    saves: history!.saves / games,
    shots: history!.shots / games,
  };
}

/** Stat points per series before the matchup and the win bonus. */
export function projectedStatPoints(rating: number | null, history: StatTotals | null): number {
  return STAT_POINTS_PER_FP * fantasyPoints(projectedPerGameLine(rating, history));
}

export function seriesWinChance({ ownRating, oppRating, winsNeeded }: Matchup): number {
  return predictSeries(ownRating, oppRating, winsNeeded, PREDICTION_SCALE).pASeries;
}

/**
 * docs/fantasy-projections.md §2 step 3. Pinned at 1 for an even series, so the
 * league isn't projected low on average, and flat near it, so a modest favourite
 * barely moves while a lopsided series swings toward the floor or ceiling. Both
 * the projection and the RV update apply it, so a favourite's padded stats
 * aren't read as the player outplaying their rating.
 */
export function matchupMultiplier(pSeries: number): number {
  const edge = 2 * Math.min(1, Math.max(0, pSeries)) - 1;
  const swing = Math.abs(edge) ** MATCHUP_CURVE;
  return edge >= 0 ? 1 + (MATCHUP_CEILING - 1) * swing : 1 - (1 - MATCHUP_FLOOR) * swing;
}

/** docs/fantasy-projections.md §3: Σ over the team's winning scorelines of P × (winsNeeded − games lost). */
export function expectedWinBonus({ ownRating, oppRating, winsNeeded }: Matchup): number {
  return predictSeries(ownRating, oppRating, winsNeeded, PREDICTION_SCALE)
    .scorelines.filter((s) => s.winner === "A")
    .reduce((sum, s) => sum + s.probability * (winsNeeded - s.losses), 0);
}

/**
 * Projected series points: stat points adjusted for the matchup, plus the
 * expected win bonus. `rating` is null for a player with no ranks on file:
 * their history alone if they have any, the league means if they have none.
 */
export function projectedSeriesPoints(rating: number | null, history: StatTotals | null, matchup: Matchup): number {
  return projectedStatPoints(rating, history) * matchupMultiplier(seriesWinChance(matchup)) + expectedWinBonus(matchup);
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

/** A player's series points from their per-game stat rows in it, one row per game played for their own team. */
export function seriesPointsFromGames(
  games: StatLine[],
  series: { forfeit: boolean; ownScore: number; oppScore: number },
): number {
  const stats = games.reduce(
    (s, r) => ({
      score: s.score + r.score,
      goals: s.goals + r.goals,
      assists: s.assists + r.assists,
      saves: s.saves + r.saves,
      shots: s.shots + r.shots,
    }),
    { score: 0, goals: 0, assists: 0, saves: 0, shots: 0 },
  );
  return seriesFantasyPoints({ ...series, stats, gamesPlayed: games.length });
}

/** A player's last scored series beside what was projected for it before it was played. */
export type LastSeries = { points: number; projected: number };

export const TRENDING_PER_TIER = 2;

/**
 * The Players tab's trending strip: per tier, the biggest scores in their last
 * series. Raw points rather than a multiple of projection, since a multiple
 * ranks an ordinary series on a tiny projection over a big one. A tie goes to
 * whoever beat their projection by more.
 */
export function trendingByTier<T extends { tier: FantasyTier; lastSeries: LastSeries | null }>(
  players: readonly T[],
  perTier = TRENDING_PER_TIER,
): Record<FantasyTier, T[]> {
  const out: Record<FantasyTier, T[]> = { 1: [], 2: [], 3: [] };
  for (const player of players) if (player.lastSeries) out[player.tier].push(player);
  const margin = (p: T) => p.lastSeries!.points - p.lastSeries!.projected;
  for (const tier of [1, 2, 3] as const) {
    out[tier] = out[tier]
      .sort((a, b) => b.lastSeries!.points - a.lastSeries!.points || margin(b) - margin(a))
      .slice(0, perTier);
  }
  return out;
}
