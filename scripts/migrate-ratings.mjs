// Migration for the crl-final-rating-v1 rating model.
//
// The old season_rating lived on a bounded [10, 990] scale (crl-game-share-elo-v1).
// The new model (app/lib/rating.ts) produces unbounded ratings roughly in the
// 1000-1800 range. Feeding an old-scale value into the new per-game curve
// distorts every matchup, so stored ratings MUST be migrated before the new
// code serves odds.
//
// Usage (run from repo root, needs .env.local with the service-role key):
//   node scripts/migrate-ratings.mjs            # report only — counts + preview
//   node scripts/migrate-ratings.mjs --clear    # null every season_rating (recommended)
//   node scripts/migrate-ratings.mjs --replay   # recompute preseason + replay history
//   node scripts/migrate-ratings.mjs --replay --order=created_at
//
// Safe rollout sequence on a live app:
//   1. Run --clear (or --replay) while the OLD code is still deployed. Both old
//      and new code treat a null season_rating as "init from roster ratings",
//      so there is no window where an old-scale value meets the new curve.
//   2. Deploy the new code.

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// supabase-js eagerly constructs a realtime client; Node < 22 has no global
// WebSocket, so provide one. (This script never uses realtime.)
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

// ── Rating math — ported from app/lib/rating.ts (crl-final-rating-v1). Kept in
// sync by hand since this script is plain JS and can't import a TS module. ──
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

async function report() {
  const [{ data: teams }, { count: rated }, { count: completed }] = await Promise.all([
    db.from("teams").select("id, name, season_rating"),
    db.from("teams").select("*", { count: "exact", head: true }).not("season_rating", "is", null),
    db.from("matches").select("*", { count: "exact", head: true })
      .eq("status", "completed").not("home_team_id", "is", null).not("away_team_id", "is", null),
  ]);
  console.log(`Teams total: ${teams?.length ?? 0}`);
  console.log(`Teams with a stored season_rating (old scale): ${rated ?? 0}`);
  console.log(`Completed team-vs-team matches (replay length): ${completed ?? 0}\n`);

  const pre = await preseasonRatings();
  console.log("New-scale preseason ratings (from current rosters):");
  const rows = (teams ?? [])
    .map((t) => ({ name: t.name, old: t.season_rating, next: pre.get(t.id) }))
    .sort((a, b) => (b.next ?? 0) - (a.next ?? 0));
  for (const r of rows) {
    const oldStr = r.old != null ? Number(r.old).toFixed(0).padStart(4) : "  — ";
    const newStr = r.next != null ? r.next.toFixed(1).padStart(7) : "   —   ";
    console.log(`  ${(r.name ?? "?").padEnd(24)} old:${oldStr}  →  new:${newStr}`);
  }
  console.log(`\nRecommendation: run --clear unless the completed-match history above is`);
  console.log(`substantial and you want to preserve standings via --replay.`);
}

async function clear() {
  const { error, count } = await db
    .from("teams").update({ season_rating: null }, { count: "exact" })
    .not("season_rating", "is", null);
  if (error) { console.error("Clear failed:", error.message); process.exit(1); }
  console.log(`Cleared season_rating on ${count ?? 0} team(s). They will re-init on the new scale.`);
}

async function replay(orderCol) {
  const ratings = await preseasonRatings();
  const { data: matches, error } = await db
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, away_score, status")
    .eq("status", "completed")
    .not("home_team_id", "is", null).not("away_team_id", "is", null)
    .order(orderCol, { ascending: true });
  if (error) {
    console.error(`Could not order matches by "${orderCol}": ${error.message}`);
    console.error(`Pass a valid column with --order=<column> (e.g. created_at).`);
    process.exit(1);
  }

  let replayed = 0;
  for (const m of matches ?? []) {
    if (m.home_score === m.away_score) continue; // draws don't move ratings
    const rA = ratings.get(m.home_team_id) ?? initialTeamRating([]);
    const rB = ratings.get(m.away_team_id) ?? initialTeamRating([]);
    const { newRatingA, newRatingB } = applyRatingUpdate(rA, rB, m.home_score, m.away_score);
    ratings.set(m.home_team_id, newRatingA);
    ratings.set(m.away_team_id, newRatingB);
    replayed++;
  }
  console.log(`Replayed ${replayed} decisive match(es) over ${ratings.size} team(s), ordered by "${orderCol}".`);
  console.log("Note: preseason is derived from CURRENT rosters, so mid-season roster changes make this an approximation.\n");

  for (const [teamId, rating] of ratings) {
    const { error: upErr } = await db.from("teams").update({ season_rating: rating }).eq("id", teamId);
    if (upErr) console.error(`  update failed for ${teamId}: ${upErr.message}`);
  }
  console.log("Wrote replayed ratings to teams.season_rating.");
}

const args = process.argv.slice(2);
const orderArg = args.find((a) => a.startsWith("--order="));
const orderCol = orderArg ? orderArg.split("=")[1] : "created_at";

if (args.includes("--clear")) await clear();
else if (args.includes("--replay")) await replay(orderCol);
else await report();
