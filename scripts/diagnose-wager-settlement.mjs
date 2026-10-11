/**
 * Read-only post-mortem for a match whose wager settlement failed.
 *
 * settleMatchWagers (app/lib/discord-bot.ts) pushes "needs checking by hand" to
 * admins when a settle/void throws past its one retry. By then the Vercel log
 * line naming the failing step is usually gone, but the DB still says exactly
 * which step it was, because voidMatchWagers writes in a fixed order:
 *
 *   1. wagers  -> status 'void' + payout_amount  (one update per wager)
 *   2. wagers  -> increment_crl_coins            (one RPC per wager)
 *   3. parlays -> status/legs/credit per parlay, sequentially
 *
 * Each step's throwOnAny aborts before the next, so the surviving statuses
 * bracket the failure. `payout_amount` is written in step 1 and proves nothing
 * about step 2 — it is not evidence anyone was paid.
 *
 * Writes nothing to the database. Dumps a JSON snapshot to the temp dir —
 * never the repo, since it holds real Discord IDs and balances — because
 * resetSeason() and adminWipe() DELETE every wager and parlay row outright:
 * completing or resetting the event destroys the only record of who is owed
 * what.
 *
 * Usage: node scripts/diagnose-wager-settlement.mjs [matchId]
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

config({ path: ".env.local" });

const MATCH_ID = process.argv[2] ?? "94ab64c4-3ced-4116-95e5-9367a33f90f7";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const die = (what, error) => {
  if (!error) return;
  console.error(`Failed ${what}: ${error.message}`);
  process.exit(1);
};

const coins = (n) => `${n > 0 ? "+" : ""}${n}`;
const utc = (t) => (t ? new Date(t).toISOString().replace("T", " ").replace(".000Z", "") : "—");
const count = (rows, status) => rows.filter((r) => r.status === status).length;

const { data: match, error: matchErr } = await db
  .from("matches")
  .select("*")
  .eq("id", MATCH_ID)
  .maybeSingle();
die("reading the match", matchErr);

const { data: wagers, error: wagerErr } = await db
  .from("wagers")
  .select("*")
  .eq("match_id", MATCH_ID);
die("reading wagers", wagerErr);

const { data: legs, error: legErr } = await db
  .from("parlay_legs")
  .select("*")
  .eq("match_id", MATCH_ID);
die("reading parlay legs", legErr);

const parlayIds = [...new Set((legs ?? []).map((l) => l.parlay_id))];
let parlays = [];
if (parlayIds.length) {
  const { data, error } = await db.from("parlays").select("*").in("id", parlayIds);
  die("reading parlays", error);
  parlays = data ?? [];
}

const discordIds = [
  ...new Set([...(wagers ?? []), ...parlays].map((r) => r.player_id).filter(Boolean)),
];
let accounts = [];
if (discordIds.length) {
  const { data, error } = await db
    .from("accounts")
    .select("id, discord_id, username, display_name, crl_coins, updated_at")
    .in("discord_id", discordIds);
  die("reading accounts", error);
  accounts = data ?? [];
}
const accountByDiscordId = new Map(accounts.map((a) => [a.discord_id, a]));
// wagers.player_id is a Discord snowflake, but wager_balance_adjustments.player_id
// is an FK into players(id) (= accounts.id). Matching the log on snowflakes alone
// finds nothing and reads as "nobody has been fixed yet" — the one false all-clear
// that could get a player credited twice.
const accountByUuid = new Map(accounts.map((a) => [a.id, a]));
const accountUuids = accounts.map((a) => a.id);

// The admin correction tool's own audit log. A player already fixed by hand
// shows up here, so a second pass can't double-credit them.
const { data: adjustments, error: adjErr } = await db
  .from("wager_balance_adjustments")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(200);
if (adjErr) console.log(`(could not read wager_balance_adjustments: ${adjErr.message})\n`);

const name = (playerId) => {
  const a = accountByDiscordId.get(playerId) ?? accountByUuid.get(playerId);
  return a ? (a.display_name || a.username || playerId) : playerId;
};

console.log(`\nMatch ${MATCH_ID}`);
console.log(`Incident reported: 2026-10-11 04:04 UTC (2026-10-10 10:04 PM MDT)`);
console.log(`All timestamps below are UTC.\n`);

if (!match) {
  console.log("!! No matches row with this id.");
  console.log("   Either the id is wrong, or the event was already reset — and a reset");
  console.log("   deletes every wager row too, so there may be nothing left to reconcile.\n");
} else {
  console.log(`  status      ${match.status}`);
  console.log(`  score       ${match.home_score ?? "—"} - ${match.away_score ?? "—"}`);
  console.log(`  stage/round  ${match.stage ?? "—"} / ${match.round ?? "—"}`);
  console.log(`  scheduled   ${utc(match.scheduled_at)}`);
  console.log(`  forfeit     ${match.forfeit ?? "—"}\n`);
}

console.log(`── Wagers (${(wagers ?? []).length}) ─────────────────────────────────`);
for (const w of wagers ?? []) {
  const a = accountByDiscordId.get(w.player_id);
  console.log(
    [
      w.status.padEnd(8),
      `stake ${String(w.amount).padStart(6)}`,
      `payout_amount ${String(w.payout_amount ?? "null").padStart(6)}`,
      `balance ${String(a?.crl_coins ?? "?").padStart(7)}`,
      `acct updated ${utc(a?.updated_at)}`,
      name(w.player_id),
    ].join("  "),
  );
}
if (!(wagers ?? []).length) console.log("  (none)");

// A parlay's own status can be decided by its legs on OTHER matches, so this
// match's leg is what says whether voidMatchWagers reached this parlay.
const legHere = (parlayId) => (legs ?? []).filter((l) => l.parlay_id === parlayId);
const legStatusHere = (parlayId) => {
  const own = legHere(parlayId).map((l) => l.status);
  return own.includes("void") ? "void" : own.includes("pending") ? "pending" : (own[0] ?? "—");
};

console.log(`\n── Parlays touching this match (${parlays.length}) ───────────────`);
for (const p of parlays) {
  const a = accountByDiscordId.get(p.player_id);
  const own = legHere(p.id);
  console.log(
    [
      `leg ${legStatusHere(p.id).padEnd(8)}`,
      `parlay ${p.status.padEnd(8)}`,
      `stake ${String(p.amount).padStart(6)}`,
      `legs ${own.length}`,
      `balance ${String(a?.crl_coins ?? "?").padStart(7)}`,
      `acct updated ${utc(a?.updated_at)}`,
      name(p.player_id),
    ].join("  "),
  );
}
if (!parlays.length) console.log("  (none)");

console.log(`\n── What the statuses say happened ─────────────────────`);
const pendingWagers = count(wagers ?? [], "pending");
const voidWagers = count(wagers ?? [], "void");
const settledWagers = (wagers ?? []).filter((w) => w.status === "won" || w.status === "lost").length;
const pendingParlays = parlays.filter((p) => legStatusHere(p.id) === "pending").length;
const voidParlays = parlays.filter((p) => legStatusHere(p.id) === "void").length;

if (!(wagers ?? []).length && !parlays.length) {
  console.log("  Nothing is staked on this match. Nothing to reconcile.");
} else if (settledWagers) {
  console.log(`  ${settledWagers} wager(s) are won/lost, so this was a real settle, not a void.`);
  console.log("  Re-read settleMatchWagers' settle path before crediting anyone — the");
  console.log("  reasoning below is written for the forfeit/void path.");
} else if (pendingWagers) {
  console.log(`  ${pendingWagers} wager(s) are still 'pending' => step 1 threw.`);
  console.log("  The step-2 credit batch never ran, so NO wager on this match was paid —");
  console.log("  including the ones already marked 'void'. Parlays were never reached.");
  console.log("  Owed per void wager: its stake. Pending ones are safest left alone:");
  console.log("  voidAllPendingWagers refunds them at the next reset, and crediting them");
  console.log("  by hand now would pay twice.");
} else if (voidParlays) {
  console.log(`  All ${voidWagers} wager(s) are 'void' and ${voidParlays} parlay(s) are too.`);
  console.log("  Step 3 only starts after every step-2 credit succeeded, so all wager");
  console.log("  stakes were refunded. The parlay loop is sequential: 'pending' parlays");
  console.log("  were never touched, and the LAST 'void' one is the suspect — its");
  console.log("  update/legs/credit run in one Promise.all and can fail independently.");
} else if (voidWagers) {
  console.log(`  All ${voidWagers} wager(s) are 'void' and every parlay is still 'pending'.`);
  console.log("  Ambiguous: either step 2 failed partway (some players credited, some");
  console.log("  not) or the parlay-legs read failed (everyone credited). The step-2 RPCs");
  console.log("  are N independent calls, so a partial failure is possible — do not");
  console.log("  assume all-or-nothing. Resolve it with the two checks below.");
}

if (voidWagers || voidParlays) {
  const owed = new Map();
  for (const w of (wagers ?? []).filter((w) => w.status === "void")) {
    owed.set(w.player_id, (owed.get(w.player_id) ?? 0) + w.amount);
  }
  for (const p of parlays.filter((p) => legStatusHere(p.id) === "void")) {
    owed.set(p.player_id, (owed.get(p.player_id) ?? 0) + p.amount);
  }
  // The adjustment tool is per player, not per wager, so this is the number to
  // type in — for whichever players the checks below show were never credited.
  console.log(`\n  Owed per player if uncredited (void stakes only):`);
  for (const [playerId, total] of owed) {
    console.log(`   ${String(total).padStart(7)}  ${name(playerId)}`);
  }

  console.log(`\n  Corroboration, in rough order of strength:`);
  console.log(`   1. The escalation's console.error names the step ("what:"). Check Vercel`);
  console.log(`      runtime logs for ~04:04 UTC now — retention is short and it may be gone.`);
  console.log(`   2. Supabase API logs for POST /rest/v1/rpc/increment_crl_coins around`);
  console.log(`      04:04 UTC show how many returned 200. Also short-retention.`);
  console.log(`   3. accounts.updated_at only proves a negative: earlier than 04:04 UTC`);
  console.log(`      means that player was definitely NOT credited. A later stamp proves`);
  console.log(`      nothing — a login, theme change or new bet bumps it too.`);
}

const relevant = (adjustments ?? []).filter(
  (r) => accountUuids.includes(r.player_id) || discordIds.includes(r.player_id),
);
console.log(`\n── Prior hand corrections for these players (${relevant.length}) ──`);
for (const r of relevant) {
  console.log(
    `  ${utc(r.created_at)}  ${coins(r.amount)}  -> ${String(r.balance_after).padStart(7)}  ${name(r.player_id)}  "${r.reason ?? ""}"`,
  );
}
if (!relevant.length) console.log("  (none — nobody here has been adjusted by hand yet)");

const snapshotPath = join(tmpdir(), `wager-incident-${MATCH_ID.slice(0, 8)}.json`);
writeFileSync(
  snapshotPath,
  JSON.stringify(
    { matchId: MATCH_ID, capturedAt: new Date().toISOString(), match, wagers, legs, parlays, accounts, adjustments: relevant },
    null,
    2,
  ),
);
console.log(`\nSnapshot written to ${snapshotPath}`);
console.log("Keep it: completing or resetting this event deletes every row above.\n");
