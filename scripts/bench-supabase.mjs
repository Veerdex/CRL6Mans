// Measures how long Supabase actually takes to answer the queries the dashboard
// makes, so "the site feels slow" can be confirmed or ruled out as a DB problem.
//
// Usage (run from repo root, needs .env.local with the service-role key):
//   node scripts/bench-supabase.mjs             # 20 baseline iterations
//   node scripts/bench-supabase.mjs --n=50      # more iterations, tighter p95
//
// What it reports, and why each part is separate:
//   1. Baseline round trip - the network floor. min is the best case the
//      connection can do; the spread says whether the problem is latency or
//      variance.
//   2. Cold vs warm - the first query on a brand-new client pays DNS + TLS. On
//      Vercel every cold function start pays it again, so a big gap here is a
//      real production cost.
//   3. Hot-path queries - the actual selects a dashboard render issues, with row
//      counts, so a slow one is attributable to volume rather than to latency.
//   4. Serial vs parallel - getNameDecorations runs in stages, one after another,
//      on every dashboard page. The gap between running its queries in sequence
//      and running them together is the time parallelising would recover.
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// supabase-js builds a realtime client on construction and Node < 22 has no
// global WebSocket. This script never opens a socket, so a stub is enough.
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 20);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const newClient = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ms = (n) => `${n.toFixed(0).padStart(5)} ms`;

async function time(fn) {
  const t = performance.now();
  const res = await fn();
  return { ms: performance.now() - t, res };
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  return { min: s[0], median: pct(50), p95: pct(95), max: s[s.length - 1] };
}

const rowsOf = (res) =>
  res?.count ?? (Array.isArray(res?.data) ? res.data.length : res?.data ? 1 : 0);

console.log("=".repeat(74));
console.log("Supabase retrieval benchmark");
console.log("=".repeat(74));
console.log(`host        ${new URL(url).host}`);
console.log(`node        ${process.version}`);
console.log(`iterations  ${N}`);
console.log(`when        ${new Date().toISOString()}`);
console.log(`
This runs from THIS MACHINE, so it measures your network -> Supabase. Production
is Vercel function -> Supabase, a different path: if the function region and the
Supabase project region are far apart, prod is slower than anything here. Good
numbers below rule out a slow database; they do not prove production is fast.
Also, if the slowness was seen under "npm run dev", Turbopack compiling a route
on first request dominates that page load and no DB number will show it.
`);

// ---------------------------------------------------------------- 1. baseline
const cold = await time(() => newClient().from("league_settings").select("draft_active").single());

const warmClient = newClient();
const samples = [];
for (let i = 0; i < N; i++) {
  const { ms: t } = await time(() =>
    warmClient.from("league_settings").select("draft_active").single(),
  );
  samples.push(t);
}
const base = stats(samples);

console.log("1. Baseline round trip  (single-row select, repeated)");
console.log(`   cold (fresh client, DNS + TLS)  ${ms(cold.ms)}`);
console.log(`   warm min                        ${ms(base.min)}   <- network floor`);
console.log(`   warm median                     ${ms(base.median)}`);
console.log(`   warm p95                        ${ms(base.p95)}`);
console.log(`   warm max                        ${ms(base.max)}`);
console.log(
  `   handshake cost                  ${ms(cold.ms - base.median)}  (paid again on every cold start)`,
);
console.log();

// -------------------------------------------------------- 2. hot-path queries
const { data: sampleAccount } = await warmClient
  .from("accounts")
  .select("id, discord_id")
  .limit(1)
  .single();

const PATRON_COLS =
  "discord_id, username, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs, patreon_name_color, patreon_name_outline, patreon_name_glint, patreon_avatar_border";

const HOT = [
  ["league_settings (single row)", () => warmClient.from("league_settings").select("*").single()],
  [
    "accounts by discord_id (getPlayerInfo #1)",
    () =>
      warmClient
        .from("accounts")
        .select("id, status, display_name, is_guest")
        .eq("discord_id", sampleAccount.discord_id)
        .single(),
  ],
  [
    "players by account_id (getPlayerInfo #2)",
    () => warmClient.from("players").select("team_id").eq("account_id", sampleAccount.id).maybeSingle(),
  ],
  [
    "players count, drafted (head)",
    () =>
      warmClient
        .from("players")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .eq("draft_entered", true),
  ],
  [
    "accounts, patrons (11 cols)",
    () =>
      warmClient
        .from("accounts")
        .select(PATRON_COLS)
        .neq("status", "banned")
        .or("patreon_status.eq.active_patron,patreon_tier_override.not.is.null"),
  ],
  [
    "patreon_tier_benefits (all)",
    () => warmClient.from("patreon_tier_benefits").select("tier_title, benefit_id, value"),
  ],
  [
    "patreon_tier_prices (all)",
    () => warmClient.from("patreon_tier_prices").select("tier_title, amount_cents"),
  ],
  ["players select * (whole table)", () => warmClient.from("players").select("*")],
  ["accounts select * (whole table)", () => warmClient.from("accounts").select("*")],
  ["teams select *", () => warmClient.from("teams").select("*")],
  ["matches select *", () => warmClient.from("matches").select("*")],
  [
    "player_game_stats count (head)",
    () => warmClient.from("player_game_stats").select("*", { count: "exact", head: true }),
  ],
];

console.log("2. Hot-path queries  (median of 3, with row counts)");
const slow = [];
for (const [label, run] of HOT) {
  const runs = [];
  let last;
  for (let i = 0; i < 3; i++) {
    const { ms: t, res } = await time(run);
    runs.push(t);
    last = res;
  }
  const med = stats(runs).median;
  const err = last?.error ? `  ERROR ${last.error.message}` : "";
  console.log(`   ${ms(med)}  ${String(rowsOf(last)).padStart(6)} rows  ${label}${err}`);
  if (med > base.median * 3) slow.push([label, med]);
}
console.log();

// ----------------------------------------------------- 3. serial vs parallel
const patrons = () =>
  warmClient
    .from("accounts")
    .select(PATRON_COLS)
    .neq("status", "banned")
    .or("patreon_status.eq.active_patron,patreon_tier_override.not.is.null");
const prices = () => warmClient.from("patreon_tier_prices").select("tier_title, amount_cents");
const benefits = () =>
  warmClient.from("patreon_tier_benefits").select("tier_title, benefit_id, value");
const mirrors = (ids) => warmClient.from("players").select("discord_id, username").in("discord_id", ids);

const { res: patronRes } = await time(patrons);
const patronIds = (patronRes.data ?? []).map((p) => p.discord_id);

const { ms: serialMs } = await time(async () => {
  await patrons();
  await prices();
  await benefits();
  await mirrors(patronIds);
});
const { ms: parallelMs } = await time(async () => {
  await Promise.all([patrons(), prices(), benefits(), mirrors(patronIds)]);
});

console.log("3. getNameDecorations  (runs on EVERY dashboard page)");
console.log(`   its four queries in sequence    ${ms(serialMs)}`);
console.log(`   the same four at once           ${ms(parallelMs)}`);
console.log(`   recoverable by parallelising    ${ms(serialMs - parallelMs)}`);
console.log(`   patrons matched                 ${patronIds.length}`);
console.log();

// ---------------------------------------------------------------- 4. verdict
console.log("Verdict");
if (base.median > 250) {
  console.log(`   Round trips are SLOW (${base.median.toFixed(0)} ms median). Every query pays this.`);
  console.log("   Likely a distance problem - check which region the Supabase project is in.");
} else if (base.median > 100) {
  console.log(`   Round trips are middling (${base.median.toFixed(0)} ms median). Fine one at a time, but`);
  console.log("   the dashboard layout issues them mostly in sequence, so they add up.");
} else {
  console.log(`   Round trips are fast (${base.median.toFixed(0)} ms median). The database itself is not the`);
  console.log("   bottleneck from here - look at how MANY of them a page render makes.");
}
if (base.p95 > base.median * 2.5) {
  console.log(
    `   High variance (p95 ${base.p95.toFixed(0)} ms vs median ${base.median.toFixed(0)} ms) - an unstable link or a`,
  );
  console.log("   throttled/paused Supabase instance looks like this.");
}
if (slow.length) {
  console.log("   Costing well over one round trip, so real work rather than just latency:");
  for (const [label, t] of slow) console.log(`     ${ms(t)}  ${label}`);
}
console.log(
  `   A dashboard render makes roughly a dozen round trips, largely in sequence: about`,
);
console.log(
  `   ${((base.median * 12) / 1000).toFixed(1)}s of pure waiting at ${base.median.toFixed(0)} ms each, before any HTML is sent.`,
);
