// Seed career-points credit for a season that finished before the site existed.
//
//   node scripts/seed-past-season.mjs scripts/past-seasons/<event>.json
//   node scripts/seed-past-season.mjs scripts/past-seasons/<event>.json --confirm
//   node scripts/seed-past-season.mjs scripts/past-seasons/<event>.json --verify
//
// Add --stats to any of those to write seeded_player_stats instead of
// player_event_results, off the config's statsFile. Same run, same name->id
// resolution: the scoreboard is credited to exactly the accounts the placement
// was, so the two can never disagree about who played.
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
const STATS = process.argv.includes("--stats");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i === -1 ? null : process.argv[i + 1];
})();

if (!CONFIG_PATH) {
  console.error("usage: node scripts/seed-past-season.mjs <config.json> [--stats] [--confirm] [--only <discord_id>] [--verify]");
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
// then the placements.
//
// Anchoring the roster on "first cell is the team, last three are the players"
// survives a row whose division wrapped into an extra cell, and a year that has
// no division column at all.
const raw = fs.readFileSync(cfg.placementFile, "utf8").split(/\r?\n/);

const lc = (s) => s.trim().toLowerCase();

// teamAliases maps a misspelling to the team's real name, whichever side of the
// file the typo landed on — 2025 has the roster row wrong and the placement
// block right. Both sides are renamed, so team_name records the real name.
const aliases = new Map(Object.entries(cfg.teamAliases ?? {}).map(([from, to]) => [lc(from), to]));
const aliasUsed = new Set();
const canonical = (name) => {
  const hit = aliases.get(lc(name));
  if (!hit) return name.trim();
  aliasUsed.add(lc(name));
  return hit;
};

const teams = [];
let rosterEnd = 1;
for (; rosterEnd < raw.length; rosterEnd++) {
  if (!raw[rosterEnd].trim()) break;
  const f = raw[rosterEnd].split("\t").map((s) => s.trim()).filter(Boolean);
  if (f.length < 4) throw new Error(`short roster row: ${JSON.stringify(raw[rosterEnd])}`);
  teams.push({ name: canonical(f[0]), roster: f.slice(-3) });
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

// Two shapes in the wild: "<Team Name>: <band>" per line, or a bare band label
// heading a block of team names.
const placements = new Map();
let heading = null;
for (const line of raw.slice(rosterEnd)) {
  const text = line.trim();
  if (!text) { heading = null; continue; }
  const inline = text.match(/^(.+?):\s*(\S.*?)$/);
  const inlineBand = inline && band(inline[2]);
  if (inlineBand) { placements.set(lc(canonical(inline[1])), inlineBand); heading = null; continue; }
  const b = band(text);
  if (b) { heading = b; continue; }
  if (heading) placements.set(lc(canonical(text)), heading);
}

const fatal = [];
for (const t of teams) if (!placements.has(lc(t.name))) fatal.push(`roster team "${t.name}" has no placement line`);
for (const k of placements.keys()) if (!teams.some((t) => lc(t.name) === k)) fatal.push(`placement "${k}" has no roster row`);
for (const from of aliases.keys()) if (!aliasUsed.has(from)) fatal.push(`teamAliases "${from}" matches no team name in the file`);
if (teams.length !== cfg.teamCount) fatal.push(`parsed ${teams.length} teams, config says ${cfg.teamCount}`);
// prizePool feeds eventPoints and endedAt orders the profile modal; a placeholder
// for either writes rows that look right and are not.
if (cfg.prizePool == null) fatal.push(`prizePool is not set`);
if (cfg.endedAt == null) fatal.push(`endedAt is not set`);

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

// A player who has since left the guild has no id left to record anywhere. Their
// roster name stands in for it, which keeps the team whole and the participant
// count honest; no Discord account can ever log in as a name, so the row is a
// pure archive until someone identifies them and it is re-run with a real id.
const archived = new Set(cfg.archived ?? []);

// A player who has left the guild but whose id we recovered from elsewhere. The
// id is real, so the credit still attaches the moment they log in — the only
// thing missing is a member row to check the id against, which is exactly what
// makes an unlisted manual id fatal otherwise. Naming them here is the opt-in
// that says "absent on purpose" rather than "mistyped".
const departed = new Set(cfg.departed ?? []);

const slots = [];
const unresolved = [];

for (const t of teams) {
  const b = placements.get(lc(t.name));
  for (const name of t.roster) {
    if (archived.has(name)) {
      const member = { discord_id: name, username: "", in_site: "no", in_guild: "no" };
      slots.push({ name, team: t.name, band: b, member, how: "archived" });
      continue;
    }
    const forced = manual[name];
    if (forced) {
      const m = byId.get(forced)
        ?? (departed.has(name) ? { discord_id: forced, username: "", in_site: "no", in_guild: "no" } : null);
      if (!m) { unresolved.push(`"${name}" -> ${forced} is not in ${cfg.membersCsv}`); continue; }
      slots.push({ name, team: t.name, band: b, member: m, how: departed.has(name) ? "departed" : "manual" });
      continue;
    }
    const hits = index.get(norm(name)) ?? [];
    if (hits.length === 1) slots.push({ name, team: t.name, band: b, member: hits[0], how: "auto" });
    else unresolved.push(`"${name}" (${t.name}, ${b.label}): ${hits.length === 0 ? "no match" : `${hits.length} candidates`} — add it to "manual"`);
  }
}

for (const k of Object.keys(manual)) {
  if (!teams.some((t) => t.roster.includes(k))) fatal.push(`manual entry "${k}" matches no roster slot`);
  if (archived.has(k)) fatal.push(`"${k}" is in both manual and archived`);
}
for (const k of archived) {
  if (!teams.some((t) => t.roster.includes(k))) fatal.push(`archived entry "${k}" matches no roster slot`);
}
for (const k of departed) {
  if (!manual[k]) fatal.push(`departed entry "${k}" has no id in manual`);
  if (archived.has(k)) fatal.push(`"${k}" is in both departed and archived`);
  // Once they are back in the guild the exemption is stale, and keeping it would
  // go on skipping the typo check on an id we can now actually verify.
  if (manual[k] && byId.has(manual[k])) fatal.push(`departed entry "${k}" is in ${cfg.membersCsv} — drop it from "departed"`);
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
    // A null discordId is what makes the profile modal render a teammate as
    // plain text instead of a button opening a profile that cannot exist. Only
    // an archived name earns that: a departed player's id is real, so the link
    // starts working by itself the day they log in.
    .map((mate) => ({
      discordId: mate.how === "archived" ? null : mate.member.discord_id,
      username: mate.member.username || mate.name,
      displayName: mate.name,
    })),
}));

// --- seeded scoreboard totals (--stats) ---------------------------------
// A whitespace- or tab-separated table: a header naming the columns, then one
// row per player. The player column may contain spaces, so a row is split on
// its trailing run of numbers rather than on the separator.
const STAT_LABELS = {
  games: "games", gp: "games",
  goals: "goals", gls: "goals",
  assists: "assists", ast: "assists",
  saves: "saves", sv: "saves",
  shots: "shots", sh: "shots",
  score: "score", sc: "score",
  demos: "demos", dm: "demos",
  demoed: "demoed", dmd: "demoed",
};
const ZERO_STATS = { games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0, demos: 0, demoed: 0 };

function parseStatsFile(path) {
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error(`${path} is empty`);

  const fields = lines[0].trim().split(/[\t ]+/).slice(1).map((h) => {
    const field = STAT_LABELS[h.toLowerCase().replace(/[^a-z]/g, "")];
    if (!field) throw new Error(`unknown stats column "${h}" in ${path}`);
    return field;
  });
  if (new Set(fields).size !== fields.length) throw new Error(`duplicate stats column in ${path}`);

  return lines.slice(1).map((line) => {
    const m = line.trim().match(/^(.+?)[\t ]+((?:\d+[\t ]+)*\d+)$/);
    if (!m) throw new Error(`stats row is not "<name> <numbers>": ${JSON.stringify(line)}`);
    const values = m[2].split(/[\t ]+/).map(Number);
    if (values.length !== fields.length) {
      throw new Error(`stats row "${m[1]}" has ${values.length} values, header has ${fields.length}`);
    }
    return { name: m[1].trim(), stats: Object.fromEntries(fields.map((f, i) => [f, values[i]])) };
  });
}

let statRows = [];
if (STATS) {
  if (!cfg.statsFile) fatal.push(`--stats needs "statsFile" in the config`);
  else {
    const parsed = parseStatsFile(cfg.statsFile);

    const byName = new Map();
    for (const p of parsed) {
      if (byName.has(norm(p.name))) fatal.push(`stats file lists "${p.name}" twice`);
      byName.set(norm(p.name), p);
    }

    // An archived slot's discord_id is its roster name, which no account can
    // ever log in as — a stats row keyed on one would wait forever. This is the
    // "skip the names we could not match" case, made explicit rather than left
    // to happen by accident.
    const skipped = slots.filter((s) => s.how === "archived");
    const matched = [];
    for (const s of slots) {
      if (s.how === "archived") continue;
      const hit = byName.get(norm(s.name));
      if (!hit) { fatal.push(`roster slot "${s.name}" (${s.team}) has no row in the stats file`); continue; }
      byName.delete(norm(s.name));
      matched.push({ slot: s, stats: hit.stats });
    }
    for (const leftover of byName.values()) {
      if (skipped.some((s) => norm(s.name) === norm(leftover.name))) continue;
      fatal.push(`stats row "${leftover.name}" matches no roster slot`);
    }

    // games is the divisor behind MVP and every per-game column. Seeding a row
    // with goals but no games would divide those goals by whatever games the
    // player later plays live, and the number would drift further every season.
    const noGames = matched.filter(({ stats }) => !(stats.games > 0));
    if (noGames.length) {
      fatal.push(
        `${noGames.length} row(s) have no games played — their goals would be divided by whatever games they later play live: ` +
        noGames.map(({ slot }) => slot.name).join(", "),
      );
    }

    statRows = matched.map(({ slot, stats }) => ({
      event_id: cfg.eventId,
      discord_id: slot.member.discord_id,
      display_name: slot.name,
      ...ZERO_STATS,
      ...stats,
      updated_at: new Date().toISOString(),
    }));

    console.log(`stats file: ${parsed.length} rows -> ${matched.length} credited, ${skipped.length} skipped without an id (${skipped.map((s) => s.name).join(", ") || "none"})`);
    console.log(`  columns: ${Object.keys(ZERO_STATS).filter((f) => f in (matched[0]?.stats ?? {})).join(", ")}`);
  }
}

// --- report -------------------------------------------------------------
console.log(`${cfg.eventName} — ${cfg.eventKind}, ${cfg.teamCount} teams, prize pool ${cfg.prizePool}, ended ${cfg.endedAt}`);
console.log(`  roster slots: ${teams.length * 3}`);
console.log(`  resolved: ${slots.length} (auto ${slots.filter((s) => s.how === "auto").length}, manual ${slots.filter((s) => s.how === "manual").length}, departed with an id ${slots.filter((s) => s.how === "departed").length}, archived without an id ${slots.filter((s) => s.how === "archived").length})`);
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
const TABLE = STATS ? "seeded_player_stats" : "player_event_results";
const ON_CONFLICT = STATS ? "event_id,discord_id" : "event_kind,event_id,discord_id";

async function upsert(batch) {
  const res = await fetch(
    `${SB}/rest/v1/${TABLE}?on_conflict=${ON_CONFLICT}`,
    {
      method: "POST",
      headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

if (VERIFY && STATS) {
  const res = await fetch(
    `${SB}/rest/v1/seeded_player_stats?event_id=eq.${cfg.eventId}&select=discord_id,display_name,games,goals,assists,saves,shots,score,demos,demoed&order=goals.desc`,
    { headers: SB_HEADERS },
  );
  const stored = await res.json();
  console.log(`\nstored rows: ${stored.length}`);
  const sum = (f) => stored.reduce((n, r) => n + r[f], 0);
  console.log(`stored totals: ${Object.keys(ZERO_STATS).map((f) => `${f}=${sum(f)}`).join(" ")}`);
  console.log(stored.slice(0, 3));
  process.exit(0);
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

const pending = STATS ? statRows : rows;

if (!CONFIRM) {
  console.log(`\nDry run. ${pending.length} ${TABLE} rows ready. Re-run with --confirm to write.`);
  process.exit(0);
}

const toWrite = ONLY ? pending.filter((r) => r.discord_id === ONLY) : pending;
if (!toWrite.length) {
  console.error(`--only ${ONLY} matched no row`);
  process.exit(1);
}
for (let i = 0; i < toWrite.length; i += 100) await upsert(toWrite.slice(i, i + 100));
console.log(`\nWrote ${toWrite.length} ${TABLE} rows.`);
