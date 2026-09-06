// One-time cleanup for enrollment proof stored before approval started
// deleting it. Prints a plan and does nothing unless run with --confirm.
//
//   node scripts/purge-college-ids.mjs            # dry run
//   node scripts/purge-college-ids.mjs --confirm  # delete
//
// Raw fetch rather than @supabase/supabase-js: createClient() throws on Node 20
// ("detected without native WebSocket support") before any query can run.

import { config } from "dotenv";
config({ path: ".env.local" });

const BUCKET = "college-ids";
const PLACEHOLDER = ".emptyFolderPlaceholder";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const confirmed = process.argv.includes("--confirm");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest(path, init) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers, ...init });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function objectName(u) {
  if (!u) return null;
  const marker = `/${BUCKET}/`;
  const at = u.lastIndexOf(marker);
  if (at === -1) return null;
  const name = u.slice(at + marker.length).split("?")[0];
  return name ? decodeURIComponent(name) : null;
}

const listRes = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ prefix: "", limit: 1000, offset: 0 }),
});
if (!listRes.ok) throw new Error(`list: ${listRes.status} ${await listRes.text()}`);
const files = await listRes.json();

const accounts = await rest("accounts?select=id,username,status");
const pending = await rest("pending_players?select=account_id,college_image_url");

const statusOf = new Map(accounts.map((a) => [a.id, a.status]));
const nameOf = new Map(accounts.map((a) => [a.id, a.username]));

// A registration still awaiting review needs its proof, so anything a pending
// account points at is left alone. There are none today, but that keeps the
// script safe to re-run later.
const keep = new Set();
for (const row of pending) {
  if (statusOf.get(row.account_id) !== "pending") continue;
  const name = objectName(row.college_image_url);
  if (name) keep.add(name);
}

const doomed = files
  .map((f) => f.name)
  .filter((n) => n !== PLACEHOLDER && !keep.has(n));

const clearPending = pending.filter(
  (r) => r.college_image_url && statusOf.get(r.account_id) !== "pending",
);
console.log(`storage objects to delete: ${doomed.length}`);
for (const n of doomed) console.log(`  ${n}`);
console.log(`\nleft in place for pending review: ${keep.size}`);
console.log(`pending_players rows to clear: ${clearPending.length}`);
for (const r of clearPending) console.log(`  ${nameOf.get(r.account_id) ?? r.account_id}`);

if (!confirmed) {
  console.log("\nDry run. Re-run with --confirm to apply. This cannot be undone.");
  process.exit(0);
}

if (doomed.length) {
  const del = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ prefixes: doomed }),
  });
  if (!del.ok) throw new Error(`delete: ${del.status} ${await del.text()}`);
  console.log(`\ndeleted ${doomed.length} storage objects`);
}

// Clear by explicit id list rather than a blanket update so a row that arrives
// between the read above and this write isn't wiped unreviewed.
if (clearPending.length) {
  const ids = clearPending.map((r) => r.account_id).join(",");
  await rest(`pending_players?account_id=in.(${ids})`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ college_image_url: "" }),
  });
  console.log(`cleared ${clearPending.length} pending_players rows`);
}

console.log("done");
