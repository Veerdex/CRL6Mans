// Delete the name-keyed archive rows for players who have since been identified.
// Their real-snowflake rows are written by a normal seeder re-run; without this
// the old row is not overwritten (different discord_id) and survives as an orphan.
//
//   node drop-name-rows.mjs <eventId> <name> [<name> ...]           # show
//   node drop-name-rows.mjs <eventId> <name> [<name> ...] --confirm # delete

import fs from "fs";

const CONFIRM = process.argv.includes("--confirm");
const [eventId, ...rest] = process.argv.slice(2).filter((a) => a !== "--confirm");
if (!eventId || !rest.length) {
  console.error("usage: node drop-name-rows.mjs <eventId> <name>... [--confirm]");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const inList = `(${rest.map((n) => `"${n}"`).join(",")})`;
const q = `event_id=eq.${eventId}&discord_id=in.${encodeURIComponent(inList)}`;

const before = await fetch(`${SB}/rest/v1/player_event_results?${q}&select=discord_id,display_name,team_name,placement`, { headers: H });
const rows = await before.json();
if (!before.ok) { console.error(rows); process.exit(1); }

console.log(`${rows.length} name-keyed row(s) under ${eventId}:`);
for (const r of rows) console.log(`  ${r.discord_id.padEnd(10)} ${r.team_name} — placement ${r.placement}`);

const missing = rest.filter((n) => !rows.some((r) => r.discord_id === n));
if (missing.length) console.log(`  not present: ${missing.join(", ")}`);

if (!CONFIRM) {
  console.log("\nDry run. Re-run with --confirm to delete.");
  process.exit(0);
}

const del = await fetch(`${SB}/rest/v1/player_event_results?${q}`, {
  method: "DELETE",
  headers: { ...H, Prefer: "return=representation" },
});
const deleted = await del.json();
if (!del.ok) { console.error(deleted); process.exit(1); }
console.log(`\nDeleted ${deleted.length} row(s).`);
