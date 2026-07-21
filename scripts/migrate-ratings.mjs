// Migration for the crl-game-share-elo-v1 rating model.
//
// The old season_rating lived on a bounded [10, 990] scale. The new model
// (app/lib/rating.ts) produces unbounded ratings around 1000–1800. Feeding an
// old-scale value into the new per-game curve squashes every matchup toward
// 50/50, so stored ratings MUST be migrated before the new code serves odds.
//
// Usage (run from repo root, needs .env.local with the service-role key):
//   node scripts/migrate-ratings.mjs            # report only — counts + preview
//   node scripts/migrate-ratings.mjs --clear    # null every season_rating (recommended)
//   node scripts/migrate-ratings.mjs --replay   # recompute preseason + replay history
//   node scripts/migrate-ratings.mjs --replay --order=created_at
//
// Safe rollout sequence on a live app:
//   1. Run --clear (or --replay) while the OLD code is still deployed. Both old
//      and new code treat a null season_rating as "init from roster RVs", so
//      there is no window where an old-scale value meets the new curve.
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

// ── Rating math — kept in sync with app/lib/rating.ts (crl-game-share-elo-v1) ──
const JOIN_POINT_RV = 1850, JOIN_VALUE = 1758.38, ABOVE_SLOPE = 0.91;
const POWER_MEAN_P = 9.0, PER_GAME_SCALE = 650, ELO_CONFIDENCE = 1.5, RATING_K = 35;

function rvToPower(rv) {
  const v = Number.isFinite(rv) && rv > 0 ? rv : 0;
  const sigmoid = 1 / (1 + Math.exp(-(v - 1200) / 220));
  if (v <= JOIN_POINT_RV) return v * sigmoid;
  return JOIN_VALUE + ABOVE_SLOPE * (v - JOIN_POINT_RV);
}
function teamRatingFromRVs(rvs, p = POWER_MEAN_P) {
  const filled = rvs.filter((v) => Number.isFinite(v));
  if (filled.length === 0) return rvToPower(1200);
  const avg = filled.reduce((s, v) => s + v, 0) / filled.length;
  while (filled.length < 3) filled.push(avg);
  const powers = filled.slice(0, 3).map(rvToPower);
  const meanPower = powers.reduce((s, v) => s + Math.pow(v, p), 0) / powers.length;
  return Math.pow(meanPower, 1 / p);
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
function rankValue(p) {
  return (
    (Number(p.peak_2v2) + Number(p.current_2v2)) * 1.2 +
    (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.8
  ) / 4;
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
    const rA = ratings.get(m.home_team_id) ?? teamRatingFromRVs([]);
    const rB = ratings.get(m.away_team_id) ?? teamRatingFromRVs([]);
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
