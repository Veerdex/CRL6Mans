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
// stood immediately before N was played — same math as migrate-ratings.mjs.
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
const DIRECT_MULTIPLIERS = { "1v1": 0.8679660395675698, "2v2": 1.0, "3v3": 0.62520694090533 };
const PLAYLIST_WEIGHTS = { "1v1": 0.4230321366247228, "2v2": 0.5308197709269774, "3v3": 1.0 };
const PLAYER_P = 10.0;
const TEAM_P = 11.406375356976948;
const CARRY_GAP_COEFFICIENT = 0.19904712362301297;
const PREDICTION_SCALE = 300.0;
const BASE_K = 35.0;
const UPDATE_MULTIPLIER = 2.25;
const EFFECTIVE_K = BASE_K * UPDATE_MULTIPLIER;
const SERIES_SCORE_EXPONENT = 0.335;

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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function convert1v1(value) {
  const x = clamp(value, 100, 1800);
  const converted =
    2.10341072e-12 * x ** 5 -
    9.10728475e-9 * x ** 4 +
    1.323074e-5 * x ** 3 -
    0.00715501759 * x ** 2 +
    2.65919325 * x -
    106.710195;
  return clamp(converted, 100, 2800);
}
function convert3v3(value) {
  const x = clamp(value, 100, 2200);
  const t = (x - 100) / 2100;
  const converted =
    100 +
    2451.55314 * t -
    6221.83456 * t ** 2 +
    42144.0445 * t ** 3 -
    102271.379 * t ** 4 +
    105569.681 * t ** 5 -
    38972.0654 * t ** 6;
  return clamp(converted, 100, 2800);
}
function powerMean(values, weights, p) {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (p === 0) {
    const sum = values.reduce((s, v, i) => s + weights[i] * Math.log(v), 0);
    return Math.exp(sum / totalWeight);
  }
  const sum = values.reduce((s, v, i) => s + weights[i] * v ** p, 0);
  return (sum / totalWeight) ** (1 / p);
}
function calculatePlayerRating(row) {
  const average1v1 = (row.at_1v1 + row.season_1v1) / 2;
  const average2v2 = (row.at_2v2 + row.season_2v2) / 2;
  const average3v3 = (row.at_3v3 + row.season_3v3) / 2;
  const adjustedValues = [
    convert1v1(average1v1) * DIRECT_MULTIPLIERS["1v1"],
    average2v2 * DIRECT_MULTIPLIERS["2v2"],
    convert3v3(average3v3) * DIRECT_MULTIPLIERS["3v3"],
  ];
  const weights = [PLAYLIST_WEIGHTS["1v1"], PLAYLIST_WEIGHTS["2v2"], PLAYLIST_WEIGHTS["3v3"]];
  return powerMean(adjustedValues, weights, PLAYER_P);
}
function initialTeamRating(playerRatings) {
  const finite = playerRatings.filter((v) => Number.isFinite(v) && v > 0);
  const base = finite.length > 0 ? finite : [1200];
  const avg = base.reduce((s, v) => s + v, 0) / base.length;
  const padded = [...base];
  while (padded.length < 3) padded.push(avg);
  const ratings = padded.sort((a, b) => b - a).slice(0, 3);
  const baseRating = powerMean(ratings, [1, 1, 1], TEAM_P);
  const [strongest, second, weakest] = ratings;
  const carryGap = strongest - (second + weakest) / 2;
  return baseRating + CARRY_GAP_COEFFICIENT * carryGap;
}
function winProbability(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / PREDICTION_SCALE));
}
function seriesUpdateShare(gamesWon, gamesLost) {
  const poweredWon = gamesWon ** SERIES_SCORE_EXPONENT;
  const poweredLost = gamesLost ** SERIES_SCORE_EXPONENT;
  return poweredWon / (poweredWon + poweredLost);
}
function applyRatingUpdate(ratingA, ratingB, gamesA, gamesB) {
  const probabilityA = winProbability(ratingA, ratingB);
  const updateShareA = seriesUpdateShare(gamesA, gamesB);
  const deltaA = EFFECTIVE_K * (updateShareA - probabilityA);
  return { newRatingA: ratingA + deltaA, newRatingB: ratingB - deltaA };
}
function nChooseK(n, k) {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}
function seriesWinProbability(perGameP, winsNeeded) {
  let total = 0;
  for (let losses = 0; losses < winsNeeded; losses++) {
    const gamesPlayed = winsNeeded + losses;
    total += nChooseK(gamesPlayed - 1, losses) * Math.pow(perGameP, winsNeeded) * Math.pow(1 - perGameP, losses);
  }
  return total;
}
function computeWinProbFromRatings(homeRating, awayRating, bestOf) {
  const winsNeeded = Math.ceil(bestOf / 2);
  const perGameH = winProbability(homeRating, awayRating);
  const homeWinProb = seriesWinProbability(perGameH, winsNeeded);
  return { homeWinProb, awayWinProb: 1 - homeWinProb };
}
function playerRatingOf(p) {
  return calculatePlayerRating({
    at_1v1: Number(p.peak_1v1 ?? 0),
    season_1v1: Number(p.current_1v1 ?? 0),
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
    .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
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
  const ratings = await preseasonRatings();
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
      const { newRatingA, newRatingB } = applyRatingUpdate(rA, rB, m.home_score, m.away_score);
      ratings.set(m.home_team_id, newRatingA);
      ratings.set(m.away_team_id, newRatingB);
    }
  }
  console.log(`Backfilled ${written} match(es) out of ${completed.length} completed.`);
}

const args = process.argv.slice(2);
if (args.includes("--apply")) await apply();
else await report();
