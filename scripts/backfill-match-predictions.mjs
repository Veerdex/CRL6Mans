// One-time backfill for the wagers "all matches" grid's frozen win% snapshot.
//
// freezeUnfrozenMatchPredictions (app/lib/match-predictions.ts, run every minute
// from the tournament-scheduler cron) only ever freezes matches that are NOT YET
// completed, so it always captures a legitimate pre-game rating going forward.
// It deliberately skips already-completed matches, because their season_rating
// already reflects that match's own result — freezing from it would show the
// post-game rating, not the pre-game one.
//
// This script covers that gap for matches completed BEFORE the feature shipped:
// it replays every completed match in chronological order from each team's
// preseason rating, so the win% written for match N reflects the rating as it
// stood immediately before N was played. Uses the current crl-final-rating-v1
// formula (app/lib/rating.ts) — migrate-ratings.mjs is a historical, already-run
// script pinned to the older crl-game-share-elo-v1 formula and is intentionally
// left alone.
//
// Ordering: bracket-server.ts inserts an entire elimination/hybrid bracket (every
// round, both WB and LB) in one bulk `.insert(...)`, so rows from the same bracket
// share ~the same created_at — sorting by created_at alone can't tell R1 from the
// final. We break ties with a stage-priority table (WB before LB before GF) and
// round ascending, which recovers true order within one stage. Cross-stage order
// (group -> swiss -> bracket) is still correct from created_at, since those are
// separate bulk-insert events fired at genuinely different times.
//
// Residual approximation: within a double-elim/hybrid stage, WB and LB rounds
// truly interleave in real play (LB Rn depends on both WB Rn and LB R(n-1)), which
// a round-number heuristic can't perfectly reconstruct without a real completion
// timestamp. This only affects the historical backfill for brackets completed
// before deployment — going forward, freezeUnfrozenMatchPredictions freezes each
// match's prediction live, before it's played, so no ordering guess is needed.
//
// Also: preseason rating is derived from CURRENT rosters, so mid-season roster
// changes (subs, kicks) are not reflected in earlier matches. Pre-game beats
// post-game, but it isn't a perfect historical reconstruction.
//
// Usage (run from repo root, needs .env.local with the service-role key):
//   node scripts/backfill-match-predictions.mjs           # report only
//   node scripts/backfill-match-predictions.mjs --apply   # write predictions

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

if (typeof globalThis.WebSocket === "undefined") {
  const { default: ws } = await import("ws");
  globalThis.WebSocket = ws;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key);

// ── Rating + prediction math — ported from app/lib/rating.ts and
// app/dashboard/wagers/prediction.ts (crl-final-rating-v1). Kept in sync by
// hand since this script is plain JS and can't import a TS module. ──
const G = 0.7010212656429836;
const PLAYER_POWER_2V2 = 1.998633623123169;
const PLAYER_POWER_3V3 = 1.817444086074829;
const MULTIPLIER_3V3 = 1.0564093589782715;
const PLAYER_AGGREGATION = 5;
const TOP_TWO_POWER = 0.7856990694999695;
const WEAKEST_WEIGHT = 0.03655501495514598;
const PREDICTION_SCALE = 643.3922991071429;
const UPDATE_SCALE = 3237.496337890625;
const K = 40.476104736328125;
const MARGIN_WEIGHT = 0.6977210324151175;
const FORM_RETENTION = 0.9489016812188285;
const GAME_COUNT_EXPONENT = 0.637790322303772;

// Tiebreaker for matches sharing a created_at (same bulk bracket insert) — lower
// sorts earlier. WB before LB before grand final; anything unlisted (group,
// swiss, SE, qualifiers) has only one bracket per stage so priority doesn't matter.
const STAGE_PRIORITY = {
  deq_winners: 0, deq_losers: 1,
  de_winners: 0, de_losers: 1, de_grand_final: 2,
  hybrid_ub: 0, hybrid_lb: 1, hybrid_sf: 2, hybrid_gf: 3,
  hybrid8_ub: 0, hybrid8_lb: 1, hybrid8_sf: 2, hybrid8_gf: 3,
};
function stagePriority(stage) {
  return STAGE_PRIORITY[stage] ?? 0;
}
function byPlayOrder(a, b) {
  const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (t !== 0) return t;
  const p = stagePriority(a.stage) - stagePriority(b.stage);
  if (p !== 0) return p;
  return (a.round ?? 0) - (b.round ?? 0);
}

function powerMean(values, power) {
  const total = values.reduce((sum, v) => sum + v ** power, 0);
  return (total / values.length) ** (1 / power);
}
function calculatePlayerRating(row) {
  const twoVTwoRating = powerMean([row.at_2v2, row.season_2v2], PLAYER_POWER_2V2);
  const scaled3v3AllTime = MULTIPLIER_3V3 * row.at_3v3;
  const scaled3v3Season = MULTIPLIER_3V3 * row.season_3v3;
  const threeVThreeRating = powerMean([scaled3v3AllTime, scaled3v3Season], PLAYER_POWER_3V3);
  const twoVTwoWeight = 2 * Math.min(G, 0.5);
  const threeVThreeWeight = 2 - 2 * Math.max(G, 0.5);
  return (
    (twoVTwoWeight * twoVTwoRating ** PLAYER_AGGREGATION +
      threeVThreeWeight * threeVThreeRating ** PLAYER_AGGREGATION) /
    (twoVTwoWeight + threeVThreeWeight)
  ) ** (1 / PLAYER_AGGREGATION);
}
function initialTeamRating(playerRatings) {
  const finite = playerRatings.filter((v) => Number.isFinite(v) && v > 0);
  const base = finite.length > 0 ? finite : [1200];
  const avg = base.reduce((s, v) => s + v, 0) / base.length;
  const padded = [...base];
  while (padded.length < 3) padded.push(avg);
  const [strongest, second, weakest] = padded.sort((a, b) => b - a).slice(0, 3);
  const topTwoCore = powerMean([strongest, second], TOP_TWO_POWER);
  return (1 - WEAKEST_WEIGHT) * topTwoCore + WEAKEST_WEIGHT * weakest;
}
function applyFormRetention(currentRating, initialRating) {
  return initialRating + FORM_RETENTION * (currentRating - initialRating);
}
function gameWinProbability(ratingA, ratingB, scale) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / scale));
}
function combination(n, k) {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= kk; index++) result = (result * (n - kk + index)) / index;
  return result;
}
function exactSeriesScoreProbability(p, losses, winsNeeded) {
  return combination(winsNeeded - 1 + losses, losses) * p ** winsNeeded * (1 - p) ** losses;
}
function predictSeries(ratingA, ratingB, winsNeeded, scale) {
  const pAGame = gameWinProbability(ratingA, ratingB, scale);
  let pASeries = 0;
  for (let losses = 0; losses < winsNeeded; losses++) pASeries += exactSeriesScoreProbability(pAGame, losses, winsNeeded);
  return { pAGame, pASeries };
}
function applyRatingUpdate(ratingA, ratingB, gamesA, gamesB, winsNeeded) {
  const gamesPlayed = gamesA + gamesB;
  const { pAGame: expectedGameShare, pASeries: expectedSeriesWin } = predictSeries(ratingA, ratingB, winsNeeded, UPDATE_SCALE);
  const binaryOutcome = gamesA > gamesB ? 1 : 0;
  const rawObservedShare = gamesA / gamesPlayed;
  const gameEvidence = (gamesPlayed / 7) ** GAME_COUNT_EXPONENT;
  const binarySurprise = binaryOutcome - expectedSeriesWin;
  const marginSurprise = rawObservedShare - expectedGameShare;
  const deltaA = K * ((1 - MARGIN_WEIGHT) * binarySurprise + MARGIN_WEIGHT * gameEvidence * marginSurprise);
  return { newRatingA: ratingA + deltaA, newRatingB: ratingB - deltaA };
}
function computeWinProbFromRatings(homeRating, awayRating, bestOf) {
  const winsNeeded = Math.ceil(bestOf / 2);
  const { pASeries: homeWinProb } = predictSeries(homeRating, awayRating, winsNeeded, PREDICTION_SCALE);
  return { homeWinProb, awayWinProb: 1 - homeWinProb };
}
function playerRatingOf(p) {
  return calculatePlayerRating({
    at_2v2: Number(p.peak_2v2 ?? 0),
    season_2v2: Number(p.current_2v2 ?? 0),
    at_3v3: Number(p.peak_3v3 ?? 0),
    season_3v3: Number(p.current_3v3 ?? 0),
  });
}
function getTier(round, totalRounds) {
  const fromFinal = totalRounds - round;
  if (fromFinal === 0) return "finals";
  if (fromFinal === 1) return "semifinals";
  if (fromFinal === 2) return "quarterfinals";
  return "standard";
}

// Ported from getStageSlotKey/resolveBestOf in app/lib/bracket.ts and
// app/dashboard/season/format-constants.ts — kept in sync by hand since this
// script is plain JS and can't import those TS modules directly.
function getStageSlotKey(stage) {
  if (stage.startsWith("group_")) return "group";
  if (stage === "swiss") return "swiss";
  if (stage === "se_qualifier") return "se_qualifier";
  if (stage === "deq_winners" || stage === "deq_losers") return "de_qualifier";
  if (stage === "de_winners" || stage === "de_losers" || stage === "de_grand_final") return "double_elimination";
  if (stage === "single_elimination") return "single_elimination";
  if (stage.startsWith("hybrid")) return "hybrid";
  return null;
}
function resolveBestOf(stage, round, maxRoundByStage, config, fallback = 3) {
  if (!stage) return fallback;
  const slotKey = getStageSlotKey(stage);
  const slotConfig = slotKey ? config?.[slotKey] : undefined;
  if (!slotConfig) return fallback;
  if (slotConfig.mode === "flat") return slotConfig.value;
  const totalRounds = maxRoundByStage[stage] ?? round;
  const tier = getTier(round, totalRounds);
  return slotConfig.tiers[tier] ?? fallback;
}

async function preseasonRatings() {
  const { data: players } = await db
    .from("players")
    .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .not("team_id", "is", null)
    .eq("status", "approved");
  const byTeam = new Map();
  for (const p of players ?? []) {
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id).push(playerRatingOf(p));
  }
  const ratings = new Map();
  for (const [teamId, playerRatings] of byTeam) ratings.set(teamId, initialTeamRating(playerRatings));
  return ratings;
}

async function loadCompletedMatches() {
  const [{ data: allMatches }, { data: settings }] = await Promise.all([
    db.from("matches")
      .select("id, stage, round, home_team_id, away_team_id, home_score, away_score, status, predicted_home_win_prob, predicted_away_win_prob, created_at")
      .not("home_team_id", "is", null).not("away_team_id", "is", null)
      .order("created_at", { ascending: true }),
    db.from("league_settings").select("season_format").single(),
  ]);

  const maxRoundByStage = {};
  for (const m of allMatches ?? []) {
    if (!m.stage) continue;
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  }
  const format = settings?.season_format ?? null;
  const fallbackBestOf = format?.best_of ?? 3;

  function bestOfForMatch(m) {
    return resolveBestOf(m.stage, m.round, maxRoundByStage, format?.roundBestOf, fallbackBestOf);
  }

  const completed = (allMatches ?? [])
    .filter((m) => m.status === "completed")
    .sort(byPlayOrder);
  return { completed, bestOfForMatch };
}

async function report() {
  const { completed } = await loadCompletedMatches();
  const missing = completed.filter((m) => m.predicted_home_win_prob == null || m.predicted_away_win_prob == null);
  console.log(`Completed matches: ${completed.length}`);
  console.log(`Missing a frozen win% snapshot: ${missing.length}`);
  console.log(`\nRun with --apply to replay ratings from preseason and backfill the missing snapshots.`);
}

async function apply() {
  // initialRatings is fixed at each team's preseason value (matches teams.initial_rating
  // in the live app); ratings is the live value that moves match-to-match. Frozen
  // predictions read the live (pre-retention) rating, same as the app's
  // computeMatchPredictionFromRating/resolveTeamRating — retention is applied only
  // inside the rating update itself, immediately before that match's delta is computed.
  const initialRatings = await preseasonRatings();
  const ratings = new Map(initialRatings);
  const { completed, bestOfForMatch } = await loadCompletedMatches();

  let written = 0;
  for (const m of completed) {
    const rA = ratings.get(m.home_team_id) ?? initialTeamRating([]);
    const rB = ratings.get(m.away_team_id) ?? initialTeamRating([]);

    if (m.predicted_home_win_prob == null || m.predicted_away_win_prob == null) {
      const bestOf = bestOfForMatch(m);
      const { homeWinProb, awayWinProb } = computeWinProbFromRatings(rA, rB, bestOf);
      const { error } = await db.from("matches")
        .update({ predicted_home_win_prob: homeWinProb, predicted_away_win_prob: awayWinProb })
        .eq("id", m.id);
      if (error) console.error(`  update failed for match ${m.id}: ${error.message}`);
      else written++;
    }

    if (m.home_score !== m.away_score) {
      const iA = initialRatings.get(m.home_team_id) ?? rA;
      const iB = initialRatings.get(m.away_team_id) ?? rB;
      const retA = applyFormRetention(rA, iA);
      const retB = applyFormRetention(rB, iB);
      const bestOf = bestOfForMatch(m);
      const winsNeeded = Math.ceil(bestOf / 2);
      const { newRatingA, newRatingB } = applyRatingUpdate(retA, retB, m.home_score, m.away_score, winsNeeded);
      ratings.set(m.home_team_id, newRatingA);
      ratings.set(m.away_team_id, newRatingB);
    }
  }
  console.log(`Backfilled ${written} match(es) out of ${completed.length} completed.`);
}

const args = process.argv.slice(2);
if (args.includes("--apply")) await apply();
else await report();
