// One-off cleanup: the old DE auto-sync logic (removed) created phantom
// `round_schedules` rows for de_losers rounds that don't correspond to any
// real LB round in a bracket (e.g. round 3/4 in a 4-team bracket where LB
// only has 2 rounds). This finds and removes any de_losers schedule row that
// has zero matching rows in `matches` for its (tournament_id, round).
//
// Usage: node scripts/cleanup-phantom-lb-rounds.mjs           # report only
//        node scripts/cleanup-phantom-lb-rounds.mjs --delete  # actually delete

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

const shouldDelete = process.argv.includes("--delete");

const { data: lbSchedules, error } = await db
  .from("round_schedules")
  .select("id, tournament_id, round, play_at")
  .eq("stage", "de_losers");

if (error) {
  console.error(error);
  process.exit(1);
}

if (!lbSchedules?.length) {
  console.log("No de_losers round_schedules rows found.");
  process.exit(0);
}

const phantoms = [];
for (const row of lbSchedules) {
  // matches has no tournament_id column — round is the only scoping key, matching
  // isRoundLocked's own convention in schedule-actions.ts.
  const { count, error: mErr } = await db.from("matches").select("*", { count: "exact", head: true })
    .eq("stage", "de_losers").eq("round", row.round);
  if (mErr) { console.error(mErr); process.exit(1); }
  if (!count) phantoms.push(row);
}

if (!phantoms.length) {
  console.log("No phantom LB round_schedules rows found — nothing to clean up.");
  process.exit(0);
}

console.log(`Found ${phantoms.length} phantom de_losers round_schedules row(s):`);
for (const p of phantoms) {
  console.log(`  id=${p.id} tournament_id=${p.tournament_id ?? "(season)"} round=${p.round} play_at=${p.play_at}`);
}

if (!shouldDelete) {
  console.log("\nDry run only — re-run with --delete to remove these rows.");
  process.exit(0);
}

const { error: delError } = await db
  .from("round_schedules")
  .delete()
  .in("id", phantoms.map((p) => p.id));

if (delError) {
  console.error("Delete failed:", delError);
  process.exit(1);
}
console.log(`Deleted ${phantoms.length} phantom row(s).`);
