/**
 * Asks production, with the public anon key, what that key can actually reach.
 *
 * Supabase publishes every table in the `public` schema at /rest/v1/<table>,
 * authorized by NEXT_PUBLIC_SUPABASE_ANON_KEY -- which ships inside the browser
 * bundle, so every visitor already has it. RLS (or a table grant) is the only
 * thing between that key and a table.
 *
 * This reads the anon key from .env.local. It never touches the service role key.
 * It prints status codes and row counts only, never row contents, and the only
 * write it attempts is filtered to an id that cannot exist, so it changes nothing
 * whether it is permitted or not.
 *
 * Read the verdicts narrowly. PostgREST answers an RLS-filtered request exactly
 * as it answers one that genuinely matched nothing, so "no rows" never convicts
 * and never acquits -- only 401/403 (no grant at all) and rows actually coming
 * back are conclusive. This probe is the outside view; the authoritative check
 * is Part 3 of scripts/rls-posture.sql, which reads the catalog directly and
 * also covers what this cannot see from out here -- views, which bypass RLS by
 * running as their owner, and SECURITY DEFINER functions.
 */

import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const read = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");

const url = read("NEXT_PUBLIC_SUPABASE_URL");
const anon = read("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!url || !anon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const headers = { apikey: anon, Authorization: `Bearer ${anon}`, Accept: "application/json" };

const TABLES = [
  "accounts",
  "players",
  "wagers",
  "parlays",
  "crl_coin_transactions",
  "wager_settlement_failures",
  "league_settings",
];

console.log("Reads with the public anon key\n");

// A 200 holding rows is conclusive: the key can read the table. A 200 holding
// none is not -- PostgREST answers an RLS-filtered read the same way it answers
// a genuinely empty table, so a table known to have rows is the only kind this
// can convict. 401/403 means the grant itself is missing.
for (const table of TABLES) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  const rows = res.status === 200 ? (await res.json()).length : null;
  const verdict =
    res.status === 401 || res.status === 403
      ? "denied"
      : res.status !== 200
        ? `HTTP ${res.status}`
        : rows > 0
          ? "READABLE"
          : "empty or filtered";
  console.log(`  ${table.padEnd(26)} ${verdict}`);
}

console.log("\nWrite with the public anon key (an update matching zero rows)\n");

// This answers a narrower question than it looks like it does, and the narrow
// answer is the one that matters.
//
// An UPDATE filtered to an id that cannot exist is refused with 401/403 when the
// role lacks the table GRANT. Anything else means the grant is there. It cannot
// go on to prove the write would land, because RLS filters silently rather than
// erroring -- "blocked by RLS" and "allowed, matched nothing" are both 204. The
// only way to tell those apart is a write that actually lands, which is not
// something to do to production to satisfy a probe.
//
// So: a 204 here means RLS is the single remaining barrier on that table. That
// is why `alter table ... enable row level security` is load-bearing and not
// belt-and-braces.
const NO_SUCH_ID = "00000000-0000-0000-0000-000000000000";

for (const [table, column] of [["crl_coin_transactions", "amount"], ["accounts", "crl_coins"]]) {
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${NO_SUCH_ID}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ [column]: 0 }),
  });
  const denied = res.status === 401 || res.status === 403;
  console.log(
    `  ${table.padEnd(26)} ${denied ? `no grant (HTTP ${res.status})` : "granted to anon -- only RLS stands in the way"}`,
  );
}

console.log("\nFunctions called with the public anon key\n");

// Postgres grants EXECUTE to PUBLIC by default and Supabase publishes every
// public function at /rest/v1/rpc/, so a new function is reachable by the anon
// key until something revokes it. A SECURITY DEFINER one is worse than an open
// table: it runs as its owner, so it bypasses RLS entirely.
//
// A function the role cannot execute comes back 404 rather than 403 -- PostgREST
// will not admit that it exists.
const FUNCTIONS = [
  // The coin mutators. A snowflake matching no account and a zero amount, so a
  // permitted call moves nothing and the refusal we want is a permissions one.
  ["credit_crl_coins", { player_discord_id: "0", coin_amount: 0 }],
  ["debit_crl_coins", { player_discord_id: "0", coin_amount: 0 }],
  ["increment_crl_coins", { player_discord_id: "0", coin_amount: 0 }],
  // SECURITY DEFINER, and was callable by anon until rls-posture.sql revoked it.
  ["get_database_size_bytes", {}],
];

for (const [fn, body] of FUNCTIONS) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const denied = res.status === 401 || res.status === 403 || res.status === 404;
  console.log(`  ${fn.padEnd(26)} ${denied ? `denied (HTTP ${res.status})` : `CALLABLE (HTTP ${res.status})`}`);
}
