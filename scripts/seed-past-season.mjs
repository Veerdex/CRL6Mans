// Seed career-points credit for a season that finished before the site existed.
//
//   node scripts/seed-past-season.mjs scripts/past-seasons/<event>.json
//   node scripts/seed-past-season.mjs scripts/past-seasons/<event>.json --confirm
//   node scripts/seed-past-season.mjs scripts/past-seasons/<event>.json --verify
//
// Without --confirm it only matches and reports; nothing is written.
//
// Why this writes player_event_results directly, against that table's usual
// rule of being a derived index: there is no archive to derive from. The event
// predates the site, so there are no `teams`, `matches` or `players` rows to
// build a full_archive out of. Hand-authoring a `seasons` row instead would put
// a matchless, statless season into the home page, the podium and the admin
// season list, and /wipe clear_history would delete it while leaving these rows
// behind anyway. rebuildEventResults() upserts and never deletes, so rows
// seeded here survive every rebuild.
//
// Nobody has to be registered, or even to have logged in: discord_id has no
// foreign key, and fetchEventHistory() finds a row the first time that Discord
// account signs in.
//
// The config file carries the event metadata and the name->discord_id
// resolutions a human had to make. Adding a second season is a new config plus
// a re-run, not a new script.

import fs from "fs";

const CONFIG_PATH = process.argv[2];
const CONFIRM = process.argv.includes("--confirm");
const VERIFY = process.argv.includes("--verify");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i === -1 ? null : process.argv[i + 1];
})();

if (!CONFIG_PATH) {
  console.error("usage: node scripts/seed-past-season.mjs <config.json> [--confirm] [--only <discord_id>] [--verify]");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

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
const SB_HEADERS = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

// --- placement file -----------------------------------------------------
// Tab separated. Row 1 is a header, then one row per team until a blank line,
// then "<Team Name>: <band>" lines grouped by band.
//
// Anchoring the roster on "first cell is the team, last three are the players"
// survives a row whose division wrapped into an extra cell.
const raw = fs.readFileSync(cfg.placementFile, "utf8").split(/\r?\n/);

const teams = [];
for (const line of raw.slice(1)) {
  if (!line.trim()) break;
  const f = line.split("\t").map((s) => s.trim()).filter(Boolean);
  if (f.length < 5) throw new Error(`short roster row: ${JSON.stringify(line)}`);
  teams.push({ name: f[0], roster: f.slice(-3) });
}

const BAND_RE = /^(\d+)(?:st|nd|rd|th)(?:\s*-\s*(\d+)(?:st|nd|rd|th))?$/i;
const band = (label) => {
  const m = label.match(BAND_RE);
  if (!m) return null;
  const start = Number(m[1]);
  const size = (m[2] ? Number(m[2]) : start) - start + 1;
  // A tied band's placement is its midpoint; tier size renders the label back.
  return { label, placement: start + (size - 1) / 2, size };
};

const lc = (s) => s.trim().toLowerCase();
const placements = new Map();
for (const line of raw) {
  const m = line.match(/^(.+?):\s*(\S.*?)\s*$/);
  if (!m) continue;
  const b = band(m[2]);
  if (b) placements.set(lc(m[1]), b);
}

const fatal = [];
for (const t of teams) if (!placements.has(lc(t.name))) fatal.push(`roster team "${t.name}" has no placement line`);
for (const k of placements.keys()) if (!teams.some((t) => lc(t.name) === k)) fatal.push(`placement "${k}" has no roster row`);
if (teams.length !== cfg.teamCount) fatal.push(`parsed ${teams.length} teams, config says ${cfg.teamCount}`);

// --- guild member index -------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csvRows = parseCsv(fs.readFileSync(cfg.membersCsv, "utf8"));
const head = csvRows[0];
const members = csvRows.slice(1)
  .filter((r) => r.length === head.length)
  .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
  .filter((m) => m.is_bot !== "yes");
const byId = new Map(members.map((m) => [m.discord_id, m]));

const stripTag = (name) => (name ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const index = new Map();
for (const m of members) {
  for (const k of new Set([m.username, m.global_name, m.server_nickname, stripTag(m.server_nickname)].map(norm).filter(Boolean))) {
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(m);
  }
}

// --- resolve every roster slot to a discord id --------------------------
const manual = cfg.manual ?? {};
const slots = [];
const unresolved = [];

for (const t of teams) {
  const b = placements.get(lc(t.name));
  for (const name of t.roster) {
    const forced = manual[name];
    if (forced) {
      const m = byId.get(forced);
      if (!m) { unresolved.push(`"${name}" -> ${forced} is not in ${cfg.membersCsv}`); continue; }
      slots.push({ name, team: t.name, band: b, member: m, how: "manual" });
      continue;
    }
    const hits = index.get(norm(name)) ?? [];
    if (hits.length === 1) slots.push({ name, team: t.name, band: b, member: hits[0], how: "auto" });
    else unresolved.push(`"${name}" (${t.name}, ${b.label}): ${hits.length === 0 ? "no match" : `${hits.length} candidates`} — add it to "manual"`);
  }
}

for (const k of Object.keys(manual)) {
  if (!teams.some((t) => t.roster.includes(k))) fatal.push(`manual entry "${k}" matches no roster slot`);
}

// The same person on two rosters would be credited twice for one event.
const seen = new Map();
for (const s of slots) {
  const prev = seen.get(s.member.discord_id);
  if (prev) fatal.push(`discord_id ${s.member.discord_id} on two rosters: "${prev.name}" (${prev.team}) and "${s.name}" (${s.team})`);
  else seen.set(s.member.discord_id, s);
}

// --- rows ---------------------------------------------------------------
const byTeam = new Map();
for (const s of slots) {
  if (!byTeam.has(s.team)) byTeam.set(s.team, []);
  byTeam.get(s.team).push(s);
}

// display_name is the roster name from the placement file: that is what this
// player was called in the bracket, and it is what the profile modal shows.
const rows = slots.map((s) => ({
  event_kind: cfg.eventKind,
  event_id: cfg.eventId,
  event_name: cfg.eventName,
  ended_at: cfg.endedAt,
  discord_id: s.member.discord_id,
  username: s.member.username || null,
  display_name: s.name,
  placement: s.band.placement,
  placement_tier_size: s.band.size,
  team_count: cfg.teamCount,
  participant_count: slots.length,
  prize_pool: cfg.prizePool,
  team_name: s.team,
  teammates: byTeam.get(s.team)
    .filter((mate) => mate.member.discord_id !== s.member.discord_id)
    .map((mate) => ({ discordId: mate.member.discord_id, username: mate.member.username || mate.name, displayName: mate.name })),
}));

// --- report -------------------------------------------------------------
console.log(`${cfg.eventName} — ${cfg.eventKind}, ${cfg.teamCount} teams, prize pool ${cfg.prizePool}, ended ${cfg.endedAt}`);
console.log(`  roster slots: ${teams.length * 3}`);
console.log(`  resolved: ${slots.length} (auto ${slots.filter((s) => s.how === "auto").length}, manual ${slots.filter((s) => s.how === "manual").length})`);
console.log(`  already on the website: ${slots.filter((s) => s.member.in_site === "yes").length}`);
console.log(`  not currently in the guild: ${slots.filter((s) => s.member.in_guild !== "yes").length}`);

const bands = new Map();
for (const r of rows) {
  const k = `${r.placement}/${r.placement_tier_size}`;
  bands.set(k, (bands.get(k) ?? 0) + 1);
}
console.log(`  placement -> players: ${[...bands.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, v]) => `${k}=${v}`).join(" ")}`);

for (const f of fatal) console.log(`  ! ${f}`);
for (const u of unresolved) console.log(`  ? ${u}`);

if (fatal.length || unresolved.length) {
  console.error(`\nRefusing to write: ${fatal.length} fatal, ${unresolved.length} unresolved.`);
  process.exit(1);
}

// --- write / verify -----------------------------------------------------
async function upsert(batch) {
  const res = await fetch(
    `${SB}/rest/v1/player_event_results?on_conflict=event_kind,event_id,discord_id`,
    {
      method: "POST",
      headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

if (VERIFY) {
  const res = await fetch(
    `${SB}/rest/v1/player_event_results?event_id=eq.${cfg.eventId}&select=discord_id,display_name,team_name,event_kind,placement,placement_tier_size,team_count,prize_pool,ended_at&order=placement.asc`,
    { headers: SB_HEADERS },
  );
  const stored = await res.json();
  console.log(`\nstored rows: ${stored.length}`);
  console.log(`stored event_kind: ${[...new Set(stored.map((r) => r.event_kind))].join(", ")}`);
  const distinct = new Map();
  for (const r of stored) distinct.set(`${r.placement}/${r.placement_tier_size}`, (distinct.get(`${r.placement}/${r.placement_tier_size}`) ?? 0) + 1);
  console.log(`stored placement -> players: ${[...distinct.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(stored.slice(0, 3));
  process.exit(0);
}

if (!CONFIRM) {
  console.log(`\nDry run. ${rows.length} rows ready. Re-run with --confirm to write.`);
  process.exit(0);
}

const toWrite = ONLY ? rows.filter((r) => r.discord_id === ONLY) : rows;
if (!toWrite.length) {
  console.error(`--only ${ONLY} matched no row`);
  process.exit(1);
}
for (let i = 0; i < toWrite.length; i += 100) await upsert(toWrite.slice(i, i + 100));
console.log(`\nWrote ${toWrite.length} rows.`);
