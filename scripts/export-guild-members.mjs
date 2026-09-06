// Read-only export of everyone the league knows about, guild-first.
//
//   node scripts/export-guild-members.mjs [out.csv]
//
// Unlike export-player-names.mjs (which starts from site `accounts` and the
// queue bot, so it can only ever describe people already in the database), this
// starts from the Discord guild member list. That is the population that matters
// while migrating: someone can be in the server and known to nobody in the DB.
//
// The CSV is the union of three sources and flags which ones each row appeared
// in, so "in the Discord but not on the website" is a filter, not a guess.
//
// Requires the SERVER MEMBERS privileged intent on the application, otherwise
// Discord answers the member-list endpoint with 403.

import fs from "fs";

const OUT = process.argv[2] ?? "guild-members.csv";

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
  if (!res.ok) {
    console.warn(`  (skipping ${table}: ${res.status})`);
    return [];
  }
  return res.json();
}

async function discord(path, { soft = false } = {}) {
  let res = await fetch(`${DISCORD}${path}`, { headers: BOT_HEADERS });
  if (res.status === 429) {
    await sleep(Number(res.headers.get("retry-after") ?? 1) * 1000 + 100);
    res = await fetch(`${DISCORD}${path}`, { headers: BOT_HEADERS });
  }
  if (!res.ok) {
    if (soft) return null;
    throw new Error(`${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Discord pages the member list by ascending user id via `after`, 1000 at a time.
// The endpoint needs the SERVER MEMBERS privileged intent; without it Discord
// answers 403/50001 and the only way to see a member is to already know their id.
async function fetchAllMembers() {
  const out = [];
  let after = "0";
  for (;;) {
    const page = await discord(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`, { soft: true });
    if (page === null) return null;
    out.push(...page);
    if (page.length < 1000) return out;
    after = page[page.length - 1].user.id;
    await sleep(120);
  }
}

// Fallback when the intent is off. /members/search needs no privileged intent
// and matches a prefix against username, nickname and global name, so sweeping
// the alphabet reaches almost everyone. A prefix that comes back at the cap is
// re-queried one character deeper. "Almost" is the catch: a name starting with
// a character outside SEED (an emoji, say) is unreachable this way, which is why
// the run is still labelled PARTIAL and measured against the true member count.
const SEED = "abcdefghijklmnopqrstuvwxyz0123456789_.-[]()!$&+~^*'";
const SEARCH_CAP = 1000;

async function fetchMembersBySearch() {
  const found = new Map();
  const queue = [...SEED];
  let queries = 0;

  while (queue.length) {
    const q = queue.shift();
    const page = await discord(
      `/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(q)}&limit=${SEARCH_CAP}`,
      { soft: true },
    );
    queries++;
    if (page) {
      for (const m of page) if (m.user?.id) found.set(m.user.id, m);
      if (page.length >= SEARCH_CAP) for (const c of SEED) queue.push(q + c);
    }
    if (queries % 10 === 0) process.stdout.write(`\r  ${queries} queries, ${found.size} members`);
    await sleep(250);
  }
  process.stdout.write(`\r  ${queries} queries, ${found.size} members\n`);
  return [...found.values()];
}

// Last resort: look each known id up one at a time. Covers only people already
// in the database, so it cannot find anyone who has never touched the site.
async function fetchMembersById(ids) {
  const out = [];
  for (const [i, id] of ids.entries()) {
    const m = await discord(`/guilds/${GUILD_ID}/members/${id}`, { soft: true });
    if (m) out.push(m);
    if (i % 25 === 24) process.stdout.write(`\r  looked up ${i + 1}/${ids.length}`);
    await sleep(60);
  }
  process.stdout.write("\r");
  return out;
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const accounts = await select("accounts", "select=discord_id,username,display_name,status&limit=5000");
const queueBot = await select("crl6mansqueuebot_players", "select=discord_id,display_name&limit=5000");

const guild = await discord(`/guilds/${GUILD_ID}?with_counts=true`, { soft: true });
const trueCount = guild?.approximate_member_count ?? null;

let members = await fetchAllMembers();
const complete = members !== null;
if (!complete) {
  console.warn(
    `\n!! SERVER MEMBERS intent is off — cannot list the guild directly.\n` +
    `   Sweeping /members/search by prefix instead.\n`
  );
  members = await fetchMembersBySearch();

  // Anyone the sweep missed but the database knows about is still recoverable
  // by id, so top up from there before giving up on them.
  const seen = new Set(members.map((m) => m.user.id));
  const missing = [...new Set([...accounts, ...queueBot].map((r) => r.discord_id).filter(Boolean))]
    .filter((id) => !seen.has(id));
  if (missing.length) {
    console.log(`  topping up ${missing.length} known ids the sweep missed`);
    members.push(...(await fetchMembersById(missing)));
  }
}

const rows = new Map();
const row = (id) => {
  if (!rows.has(id)) {
    rows.set(id, { discord_id: id, inGuild: false, inSite: false, inQueue: false, isBot: false });
  }
  return rows.get(id);
};

for (const m of members) {
  if (!m.user?.id) continue;
  const r = row(m.user.id);
  r.inGuild = true;
  r.isBot = !!m.user.bot;
  r.username = m.user.username ?? null;
  r.globalName = m.user.global_name ?? null;
  r.nick = m.nick ?? null;
  r.joinedAt = m.joined_at ?? null;
}
for (const a of accounts) {
  if (!a.discord_id) continue;
  const r = row(a.discord_id);
  r.inSite = true;
  r.siteUsername = a.username;
  r.siteDisplayName = a.display_name;
  r.siteStatus = a.status;
}
for (const p of queueBot) {
  if (!p.discord_id) continue;
  const r = row(p.discord_id);
  r.inQueue = true;
  r.queueDisplayName = p.display_name;
}

const all = [...rows.values()];
const humans = all.filter((r) => !r.isBot);

const lines = [
  "discord_id,username,server_nickname,global_name,in_guild,in_site,site_status,in_queue,is_bot,joined_at",
];
for (const r of all.sort((a, b) => (a.username ?? "").localeCompare(b.username ?? ""))) {
  lines.push([
    r.discord_id,
    r.username ?? r.siteUsername ?? "",
    r.nick ?? "",
    r.globalName ?? "",
    r.inGuild ? "yes" : "no",
    r.inSite ? "yes" : "no",
    r.siteStatus ?? "",
    r.inQueue ? "yes" : "no",
    r.isBot ? "yes" : "no",
    r.joinedAt ?? "",
  ].map(csvCell).join(","));
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

const guildNotSite = humans.filter((r) => r.inGuild && !r.inSite).length;
const siteNotGuild = all.filter((r) => r.inSite && !r.inGuild).length;
const withNick = humans.filter((r) => r.nick).length;

const botCount = all.filter((r) => r.isBot).length;

const guildRows = all.filter((r) => r.inGuild).length;
const coverage = trueCount ? `${guildRows} of ${trueCount} (${Math.round((guildRows / trueCount) * 100)}%)` : `${guildRows}`;

console.log(`\nWrote ${all.length} rows to ${OUT}`);
console.log(`  coverage: ${complete ? "COMPLETE (full guild list)" : "PARTIAL (prefix sweep)"} — ${coverage}`);
console.log(`  guild members seen: ${members.length} (${botCount} bots)`);
console.log(`  site accounts: ${accounts.length} | queue-bot: ${queueBot.length}`);
console.log(`  in guild, no site account: ${guildNotSite}`);
console.log(`  has site account, not in guild: ${siteNotGuild}`);
console.log(`  has a server nickname: ${withNick} of ${humans.length}`);
if (!complete && (trueCount === null || guildRows < trueCount)) {
  console.log(
    `\n  ${trueCount === null ? "Coverage is unverified" : `Missed ${trueCount - guildRows}`} — the prefix sweep cannot reach names\n` +
    `  starting outside its seed alphabet. For a guaranteed-complete list:\n` +
    `  Discord Developer Portal -> your app -> Bot -> Privileged Gateway Intents\n` +
    `  -> enable SERVER MEMBERS INTENT -> Save, then re-run.`
  );
}
