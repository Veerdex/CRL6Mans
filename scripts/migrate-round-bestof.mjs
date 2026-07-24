// One-time migration for the "Best Of" settings refactor: converts the OLD
// global tier-keyed roundBestOf shape (Record<RoundTier, BestOf>, e.g.
// { standard: 1, quarterfinals: 1, semifinals: 1, finals: 3 }) into the NEW
// per-stage-slot shape (RoundBestOfConfig — see
// app/dashboard/season/format-constants.ts) where each StageSlotKey
// ("group" | "swiss" | "se_qualifier" | "de_qualifier" |
// "single_elimination" | "double_elimination") carries its own independent
// { mode: "flat", value } or { mode: "tiered", tiers } config.
//
// Mapping applied to every old-shape roundBestOf found:
//   - group, swiss                         -> { mode: "flat", value: old.standard }
//       (per the new design, every group/swiss match plays one uniform bo#;
//       "standard" was the value applied to the overwhelming majority of
//       group/swiss matches under the old per-round tiering, so it's the
//       correct single value to carry forward — the old escalation to
//       "finals"/"semifinals" tiers for the last round or two of a group/swiss
//       stage is intentionally dropped, since collapsing that escalation to
//       one flat setting is the explicit point of this refactor, not a bug.)
//   - se_qualifier, de_qualifier,
//     single_elimination, double_elimination -> { mode: "tiered", tiers: old }
//       (bracket-shaped stages keep the full standard/QF/SF/finals tiering
//       structure the old config already had, just scoped to that one slot.)
//
// Without --apply, only reports what would change. Nothing is written to the
// live DB on a dry run.
//
// Usage (run from repo root, needs .env.local with the service-role key):
//   node scripts/migrate-round-bestof.mjs           # report only
//   node scripts/migrate-round-bestof.mjs --apply   # write migrated configs

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

if (typeof globalThis.WebSocket === "undefined") {
  const { default: ws } = await import("ws");
  globalThis.WebSocket = ws;
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key);

const RATIO_TIER_KEYS = new Set(["standard", "quarterfinals", "semifinals", "finals"]);
const TIERED_SLOTS = ["se_qualifier", "de_qualifier", "single_elimination", "double_elimination"];
const FLAT_SLOTS = ["group", "swiss"];

function isOldShape(roundBestOf) {
  if (!roundBestOf || typeof roundBestOf !== "object") return false;
  const keys = Object.keys(roundBestOf);
  if (keys.length === 0) return false;
  return keys.every((k) => RATIO_TIER_KEYS.has(k));
}

function migrateRoundBestOf(oldMap) {
  const fallback = oldMap.standard ?? 3;
  const next = {};
  for (const slot of FLAT_SLOTS) {
    next[slot] = { mode: "flat", value: fallback };
  }
  for (const slot of TIERED_SLOTS) {
    next[slot] = { mode: "tiered", tiers: { ...oldMap } };
  }
  return next;
}

async function collectTargets() {
  const targets = [];

  const { data: ls } = await db.from("league_settings").select("id, season_format").single();
  if (ls?.season_format?.roundBestOf && isOldShape(ls.season_format.roundBestOf)) {
    targets.push({ table: "league_settings", id: ls.id, format: ls.season_format });
  }

  const { data: tournaments } = await db.from("tournaments").select("id, name, status, format");
  for (const t of tournaments ?? []) {
    if (t.format?.roundBestOf && isOldShape(t.format.roundBestOf)) {
      targets.push({ table: "tournaments", id: t.id, name: t.name, status: t.status, format: t.format });
    }
  }

  return targets;
}

async function report() {
  const targets = await collectTargets();
  if (targets.length === 0) {
    console.log("No old-shape roundBestOf configs found. Nothing to migrate.");
    return;
  }
  console.log(`Found ${targets.length} config(s) in the old shape:\n`);
  for (const t of targets) {
    const label = t.table === "league_settings" ? "league_settings (active season)" : `tournaments.${t.name} (${t.status})`;
    console.log(`- ${label}`);
    console.log(`    old: ${JSON.stringify(t.format.roundBestOf)}`);
    console.log(`    new: ${JSON.stringify(migrateRoundBestOf(t.format.roundBestOf))}\n`);
  }
  console.log("Run with --apply to write the migrated configs.");
}

async function apply() {
  const targets = await collectTargets();
  if (targets.length === 0) {
    console.log("No old-shape roundBestOf configs found. Nothing to migrate.");
    return;
  }
  for (const t of targets) {
    const newFormat = { ...t.format, roundBestOf: migrateRoundBestOf(t.format.roundBestOf) };
    const table = t.table;
    const { error } = await db.from(table).update({ [table === "league_settings" ? "season_format" : "format"]: newFormat }).eq("id", t.id);
    if (error) {
      console.error(`  FAILED to update ${table} id=${t.id}: ${error.message}`);
    } else {
      console.log(`  Migrated ${table} id=${t.id}`);
    }
  }
}

const args = process.argv.slice(2);
if (args.includes("--apply")) await apply();
else await report();
