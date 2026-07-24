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

// ── Rating + prediction math — kept in sync with app/lib/rating.ts and
// app/dashboard/wagers/prediction.ts (crl-game-share-elo-v1) ──
const JOIN_POINT_RV = 1850, JOIN_VALUE = 1758.38, ABOVE_SLOPE = 0.91;
const POWER_MEAN_P = 9.0, PER_GAME_SCALE = 650, ELO_CONFIDENCE = 1.5, RATING_K = 35;

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

function rvToPower(rv) {
  const v = Number.isFinite(rv) && rv > 0 ? rv : 0;
  const sigmoid = 1 / (1 + Math.exp(-(v - 1200) / 220));
  if (v <= JOIN_POINT_RV) return v * sigmoid;
  return JOIN_VALUE + ABOVE_SLOPE * (v - JOIN_POINT_RV);
}
function teamRatingFromRVs(rvs) {
  const filled = rvs.filter((v) => Number.isFinite(v));
  if (filled.length === 0) return rvToPower(1200);
  const avg = filled.reduce((s, v) => s + v, 0) / filled.length;
  while (filled.length < 3) filled.push(avg);
  const powers = filled.slice(0, 3).map(rvToPower);
  const meanPower = powers.reduce((s, v) => s + Math.pow(v, POWER_MEAN_P), 0) / powers.length;
  return Math.pow(meanPower, 1 / POWER_MEAN_P);
}
function perGameExpected(rA, rB) {
  return 1 / (1 + Math.pow(10, -((rA - rB) * ELO_CONFIDENCE) / PER_GAME_SCALE));
}
function applyRatingUpdate(rA, rB, aWins, bWins) {
  const total = aWins + bWins;
  if (total <= 0) return { newRatingA: rA, newRatingB: rB };
  const rawDelta = RATING_K * (aWins / total - perGameExpected(rA, rB));
  const deltaA = Math.max(-rA, Math.min(rB, rawDelta));
  return { newRatingA: rA + deltaA, newRatingB: rB - deltaA };
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
  const perGameH = perGameExpected(homeRating, awayRating);
  const homeWinProb = seriesWinProbability(perGameH, winsNeeded);
  return { homeWinProb, awayWinProb: 1 - homeWinProb };
}
function rankValue(p) {
  return (
    (Number(p.peak_2v2) + Number(p.current_2v2)) * 1.2 +
    (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.8
  ) / 4;
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
    byTeam.get(p.team_id).push(rankValue(p));
  }
  const ratings = new Map();
  for (const [teamId, rvs] of byTeam) ratings.set(teamId, teamRatingFromRVs(rvs));
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
    const rA = ratings.get(m.home_team_id) ?? teamRatingFromRVs([]);
    const rB = ratings.get(m.away_team_id) ?? teamRatingFromRVs([]);

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
