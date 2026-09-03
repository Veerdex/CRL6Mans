// Fills the Support Us tab with throwaway patrons so the tier-section layout
// can be looked at before any real patron has opted in. Everything it writes
// is keyed by the DEMO_PREFIX below, so `clear` removes exactly what `seed`
// added and nothing else.
//
//   node scripts/seed-patreon-demo.mjs seed [perTier]
//   node scripts/seed-patreon-demo.mjs clear
//   node scripts/seed-patreon-demo.mjs status
//
// This DB is shared with production. Seeded patrons are visible to anyone
// logged in until `clear` runs.

import fs from "node:fs";

const DEMO_PREFIX = "patreondemo_";
const BENEFIT_ID = "featured-on-support-page";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// Real campaign tier titles when the stored token still works, so the rows
// seeded here match what Admin -> Tiers & Benefits would cache. Read-only: it
// never refreshes or rewrites the stored token.
async function liveTiers() {
  const [settings] = await rest(
    "league_settings?select=patreon_campaign_id,patreon_campaign_access_token,patreon_campaign_token_expires_at",
  );
  if (!settings?.patreon_campaign_id || !settings?.patreon_campaign_access_token) return null;
  const res = await fetch(
    `https://www.patreon.com/api/oauth2/v2/campaigns/${settings.patreon_campaign_id}` +
      `?include=tiers&fields%5Btier%5D=title,amount_cents`,
    { headers: { Authorization: `Bearer ${settings.patreon_campaign_access_token}` } },
  );
  if (!res.ok) return null;
  const doc = await res.json();
  const tiers = (doc.included ?? [])
    .filter((r) => r.type === "tier" && r.attributes?.title && typeof r.attributes?.amount_cents === "number")
    .map((t) => ({ title: t.attributes.title, cents: t.attributes.amount_cents }))
    .filter((t) => t.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.title.localeCompare(b.title));
  return tiers.length >= 2 ? tiers : null;
}

const PLACEHOLDER_TIERS = [
  { title: "Demo Gold Tier", cents: 1000 },
  { title: "Demo Silver Tier", cents: 500 },
  { title: "Demo Bronze Tier", cents: 200 },
];
const SIZES = ["large", "medium", "small"];

// Flat red, so demo avatars are unmistakably not real profile pictures. The
// support page passes a data-URI avatar straight through instead of building a
// Discord CDN path from it.
const DEMO_AVATAR =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%201%201'%3E%3Crect%20width%3D'1'%20height%3D'1'%20fill%3D'%23ff0000'%2F%3E%3C%2Fsvg%3E";

async function seed(perTier) {
  const live = await liveTiers();
  const tiers = live ?? PLACEHOLDER_TIERS;
  console.log(live ? "Using live campaign tiers." : "Campaign tiers unavailable; using placeholder tier names.");

  await rest("patreon_tier_prices?on_conflict=tier_title", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(
      tiers.map((t) => ({ tier_title: t.title, amount_cents: t.cents, updated_at: new Date().toISOString() })),
    ),
  });

  for (const [i, t] of tiers.entries()) {
    await rest(`patreon_tier_benefits?tier_title=eq.${encodeURIComponent(t.title)}&benefit_id=eq.${BENEFIT_ID}`, {
      method: "DELETE",
    });
    await rest("patreon_tier_benefits", {
      method: "POST",
      body: JSON.stringify([
        { tier_title: t.title, benefit_id: BENEFIT_ID, value: SIZES[Math.min(i, SIZES.length - 1)] },
      ]),
    });
  }

  const rows = [];
  for (const [i, t] of tiers.entries()) {
    for (let n = 1; n <= perTier; n++) {
      rows.push({
        discord_id: `${DEMO_PREFIX}${i + 1}_${String(n).padStart(2, "0")}`,
        username: `demo_patron_${i + 1}_${String(n).padStart(2, "0")}`,
        // Obviously-fake names: if a real member loads the page mid-review it
        // reads as staging data, not as a fabricated list of real supporters.
        display_name: `Test Patron ${i + 1}-${String(n).padStart(2, "0")}`,
        avatar: DEMO_AVATAR,
        status: "approved",
        patreon_status: "active_patron",
        patreon_tier_title: t.title,
        patreon_public: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  await rest("accounts", { method: "POST", body: JSON.stringify(rows) });

  console.log(`Seeded ${rows.length} demo patrons across ${tiers.length} tiers:`);
  tiers.forEach((t, i) => console.log(`  Tier ${i + 1}  ${t.title}  ($${(t.cents / 100).toFixed(2)})  x${perTier}`));
  console.log("\nRun `node scripts/seed-patreon-demo.mjs clear` when you are done looking.");
}

async function clear() {
  const accounts = await rest(`accounts?select=id&discord_id=like.${DEMO_PREFIX}*`);
  await rest(`accounts?discord_id=like.${DEMO_PREFIX}*`, { method: "DELETE" });

  const demoTitles = PLACEHOLDER_TIERS.map((t) => t.title);
  for (const title of demoTitles) {
    await rest(`patreon_tier_benefits?tier_title=eq.${encodeURIComponent(title)}`, { method: "DELETE" });
    await rest(`patreon_tier_prices?tier_title=eq.${encodeURIComponent(title)}`, { method: "DELETE" });
  }
  console.log(`Removed ${accounts.length} demo patrons and any placeholder tier rows.`);
  console.log("Live campaign tier prices/benefits are left alone — clear those from the admin page if you want them gone.");
}

async function status() {
  const accounts = await rest(`accounts?select=discord_id,display_name,patreon_tier_title&discord_id=like.${DEMO_PREFIX}*`);
  const prices = await rest("patreon_tier_prices?select=tier_title,amount_cents");
  const benefits = await rest("patreon_tier_benefits?select=tier_title,benefit_id,value");
  console.log(`demo patrons: ${accounts.length}`);
  console.log("tier prices:", prices);
  console.log("tier benefits:", benefits);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "seed") await seed(Number(arg) || 10);
else if (cmd === "clear") await clear();
else if (cmd === "status") await status();
else {
  console.error("usage: node scripts/seed-patreon-demo.mjs seed [perTier] | clear | status");
  process.exit(1);
}
