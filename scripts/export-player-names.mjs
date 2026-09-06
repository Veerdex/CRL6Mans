// Read-only export of every known player's Discord username, nickname, and id.
//
//   node scripts/export-player-names.mjs [out.csv]
//
// Players come from two disjoint populations that overlap only partially: site
// `accounts` and `crl6mansqueuebot_players`. The CSV covers the union and marks
// which side each row came from.
//
// Nickname is resolved from the first source that has one, most specific first:
// the guild nickname, the site display name, the queue-bot display name, then
// the Discord global name. A leading "[TAG] " is stripped; the untouched value
// is kept alongside it so nothing is lost.

import fs from "fs";

const OUT = process.argv[2] ?? "player-names.csv";

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
const SB_HEADERS = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const DISCORD = "https://discord.com/api/v10";
const BOT_HEADERS = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
const GUILD_ID = env.DISCORD_GUILD_ID;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function select(table, query) {
  const res = await fetch(`${SB}/rest/v1/${table}?${query}`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Discord's rate limits are per-route and generous here, but a 429 mid-run would
// silently drop a player from the export, so retry once on the advertised delay.
async function discord(path) {
  let res = await fetch(`${DISCORD}${path}`, { headers: BOT_HEADERS });
  if (res.status === 429) {
    await sleep(Number(res.headers.get("retry-after") ?? 1) * 1000 + 100);
    res = await fetch(`${DISCORD}${path}`, { headers: BOT_HEADERS });
  }
  await sleep(60);
  return res.ok ? res.json() : null;
}

const stripTag = (name) => (name ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const accounts = await select("accounts", "select=discord_id,username,display_name&limit=2000");
const queueBot = await select("crl6mansqueuebot_players", "select=discord_id,display_name&limit=2000");

const rows = new Map();
const row = (id) => {
  if (!rows.has(id)) rows.set(id, { discord_id: id, inSite: false, inQueue: false });
  return rows.get(id);
};

for (const a of accounts) {
  if (!a.discord_id) continue;
  const r = row(a.discord_id);
  r.inSite = true;
  r.siteUsername = a.username;
  r.siteDisplayName = a.display_name;
}
for (const p of queueBot) {
  if (!p.discord_id) continue;
  const r = row(p.discord_id);
  r.inQueue = true;
  r.queueDisplayName = p.display_name;
}

const all = [...rows.values()];
console.log(`accounts ${accounts.length} | queue-bot ${queueBot.length} | union ${all.length}`);
console.log(`Fetching Discord profiles for ${all.length} ids...`);

let inGuild = 0;
for (const r of all) {
  const user = await discord(`/users/${r.discord_id}`);
  r.discordUsername = user?.username ?? null;
  r.globalName = user?.global_name ?? null;

  const member = GUILD_ID ? await discord(`/guilds/${GUILD_ID}/members/${r.discord_id}`) : null;
  if (member) inGuild++;
  r.guildNick = member?.nick ?? null;
}

const NICK_SOURCES = [
  ["guild_nick", (r) => r.guildNick],
  ["site_display_name", (r) => r.siteDisplayName],
  ["queue_display_name", (r) => r.queueDisplayName],
  ["global_name", (r) => r.globalName],
];

let stripped = 0;
let missingUsername = 0;
const lines = ["discord_id,username,nickname,nickname_raw,nickname_source,population"];

for (const r of all.sort((a, b) => (a.discordUsername ?? "").localeCompare(b.discordUsername ?? ""))) {
  const hit = NICK_SOURCES.find(([, get]) => get(r));
  const raw = hit ? hit[1](r) : "";
  const nickname = stripTag(raw);
  if (raw && nickname !== raw.trim()) stripped++;

  const username = r.discordUsername ?? r.siteUsername ?? "";
  if (!username) missingUsername++;

  lines.push([
    r.discord_id,
    username,
    nickname,
    raw,
    hit ? hit[0] : "",
    r.inSite && r.inQueue ? "both" : r.inSite ? "site" : "queue",
  ].map(csvCell).join(","));
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

console.log(`\nWrote ${all.length} rows to ${OUT}`);
console.log(`  in guild ${GUILD_ID}: ${inGuild} of ${all.length}`);
console.log(`  "[TAG] " prefix stripped on: ${stripped}`);
if (missingUsername) console.log(`  no username resolved: ${missingUsername}`);
