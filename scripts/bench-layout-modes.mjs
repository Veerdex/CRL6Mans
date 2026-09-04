// Measures the two dashboard-chrome load schedules against each other.
//
// app/dashboard/layout-data.ts has a LOAD_MODE switch: "waterfall" awaits in
// stages, "bulk" starts every chain at once. Both issue the same queries, so
// the only difference is scheduling - and this script is what turns "bulk
// should be faster" into a number.
//
// It cannot import the loader itself (that module is server-only and needs a
// session), so it reproduces the same query graph with the same client against
// the same database. That makes it a faithful measurement of the scheduling,
// not of Next.js render overhead; the in-app `[layout timing]` console line
// under `npm run dev` is the end-to-end number.
//
// Usage (from repo root):
//   node scripts/bench-layout-modes.mjs                 # 5 rounds, first approved account
//   node scripts/bench-layout-modes.mjs --user=veerdex  # a specific account
//   node scripts/bench-layout-modes.mjs --n=10
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// supabase-js constructs a realtime client and Node < 22 has no global
// WebSocket. Nothing here opens a socket, so a stub is enough.
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const N = Number(arg("n", 5));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PATRON_COLS =
  "discord_id, username, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs, patreon_name_color, patreon_name_outline, patreon_name_glint, patreon_avatar_border";

// ── The leaf queries, mirroring app/dashboard/layout-data.ts ─────────────────
// Counted as they go, so the run can prove both schedules issued the same set
// rather than just asserting it.
let queries = 0;
const q = (builder) => {
  queries++;
  return builder;
};

const getPlayerInfo = async (discordId) => {
  const { data: account } = await q(
    db.from("accounts").select("id, status, display_name, is_guest").eq("discord_id", discordId).single(),
  );
  if (!account) return { status: "unregistered", teamId: null, isGuest: false };
  let teamId = null;
  if (account.status === "approved" || account.status === "banned") {
    const { data: player } = await q(
      db.from("players").select("team_id").eq("account_id", account.id).single(),
    );
    teamId = player?.team_id ?? null;
  }
  return { status: account.status, teamId, isGuest: !!account.is_guest };
};

const fetchSettings = async () => {
  const { data } = await q(
    db
      .from("league_settings")
      .select("draft_active, season_active, active_tournament_id, nav_tab_overrides")
      .single(),
  );
  return {
    seasonActive: data?.season_active ?? false,
    draftActive: data?.draft_active ?? false,
    activeTournamentId: data?.active_tournament_id ?? null,
  };
};

const fetchHasPlayers = async () => {
  const { count } = await q(
    db
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved")
      .eq("draft_entered", true),
  );
  return (count ?? 0) > 0;
};

// Read-only stand-in for claimGrants: the same reads, none of the writes, so a
// benchmark run can never burn a real pending grant.
const claimGrants = async (discordId, playerInfo) => {
  if (playerInfo.status === "rejected" || playerInfo.status === "banned" || playerInfo.isGuest) return;
  const { data: accountCoins } = await q(
    db
      .from("accounts")
      .select("id, crl_coins, coin_grant_pending_start, coin_grant_pending_weekly")
      .eq("discord_id", discordId)
      .single(),
  );
  if (accountCoins?.coin_grant_pending_start || accountCoins?.coin_grant_pending_weekly) {
    await q(db.from("league_settings").select("pending_start_coin_amount").single());
  }
  if (playerInfo.status === "approved") {
    await q(
      db
        .from("players")
        .select("id, team_signup_not_selected, team_signup_too_few_players")
        .eq("discord_id", discordId)
        .single(),
    );
  }
};

const getNavVisuals = async () => {
  const { data: settings } = await q(
    db
      .from("league_settings")
      .select("top_nav_sponsor_id, side_nav_sponsor_id, top_nav_design_id, side_nav_design_id")
      .single(),
  );
  const sponsorIds = [settings?.top_nav_sponsor_id, settings?.side_nav_sponsor_id].filter(Boolean);
  const designIds = [settings?.top_nav_design_id, settings?.side_nav_design_id].filter(Boolean);
  if (!sponsorIds.length && !designIds.length) return;
  await Promise.all([
    sponsorIds.length
      ? q(
          db
            .from("sponsors")
            .select("id, name, top_nav_image_url, side_nav_image_url, content_crop, click_url")
            .in("id", sponsorIds)
            .eq("status", "active"),
        )
      : Promise.resolve({}),
    designIds.length
      ? q(
          db
            .from("designs")
            .select("id, name, top_nav_image_url, side_nav_image_url, content_crop")
            .in("id", designIds)
            .eq("status", "active"),
        )
      : Promise.resolve({}),
  ]);
};

const getStaffRole = async (discordId) => {
  const { data } = await q(db.from("staff_roles").select("role").eq("discord_id", discordId).single());
  return data?.role ?? null;
};

const hasMfaEnabled = async (discordId) => {
  const { data } = await q(db.from("accounts").select("mfa_enabled").eq("discord_id", discordId).single());
  return !!data?.mfa_enabled;
};

const fetchHasTeams = async (activeTournamentId) => {
  if (activeTournamentId) {
    const { data: entries } = await q(
      db.from("tournament_entries").select("player_id").eq("tournament_id", activeTournamentId),
    );
    if (!(entries ?? []).length) return false;
    await q(
      db
        .from("players")
        .select("*", { count: "exact", head: true })
        .in(
          "id",
          entries.map((e) => e.player_id),
        )
        .not("team_id", "is", null),
    );
    return true;
  }
  await q(db.from("players").select("*", { count: "exact", head: true }).not("team_id", "is", null));
  return true;
};

const fetchHasStatsContent = async (hasActiveContent) => {
  if (hasActiveContent) return true;
  await q(db.from("player_game_stats").select("*", { count: "exact", head: true }).limit(1));
  return true;
};

const fetchHasPodium = async () => {
  await Promise.all([
    q(db.from("seasons").select("summary").eq("hidden_from_home", false).limit(20)),
    q(
      db
        .from("tournaments")
        .select("summary")
        .eq("status", "completed")
        .eq("hidden_from_home", false)
        .limit(20),
    ),
  ]);
};

const getNameDecorations = async () => {
  const { data: patrons } = await q(
    db
      .from("accounts")
      .select(PATRON_COLS)
      .neq("status", "banned")
      .or("patreon_status.eq.active_patron,patreon_tier_override.not.is.null"),
  );
  if (!patrons?.length) return;
  await Promise.all([
    q(db.from("patreon_tier_prices").select("tier_title, amount_cents")),
    q(db.from("patreon_tier_benefits").select("tier_title, benefit_id, value")),
  ]);
  await q(
    db
      .from("players")
      .select("discord_id, username")
      .in(
        "discord_id",
        patrons.map((p) => p.discord_id),
      ),
  );
};

const hasActiveContentOf = (s) => s.seasonActive || !!s.activeTournamentId;

// ── The two schedules ───────────────────────────────────────────────────────
async function waterfall(userId) {
  const settingsPromise = fetchSettings();
  const hasPlayersPromise = fetchHasPlayers();
  const navSponsorsPromise = getNavVisuals();
  const staffRolePromise = getStaffRole(userId);
  const mfaOkPromise = hasMfaEnabled(userId);

  const playerInfo = await getPlayerInfo(userId);
  await claimGrants(userId, playerInfo);

  const [settings] = await Promise.all([
    settingsPromise,
    hasPlayersPromise,
    navSponsorsPromise,
    staffRolePromise,
    mfaOkPromise,
  ]);
  await Promise.all([
    fetchHasTeams(settings.activeTournamentId),
    fetchHasStatsContent(hasActiveContentOf(settings)),
    fetchHasPodium(),
  ]);
  await getNameDecorations();
}

async function bulk(userId) {
  const settingsPromise = fetchSettings();
  const playerInfoPromise = getPlayerInfo(userId);
  await Promise.all([
    playerInfoPromise,
    playerInfoPromise.then((info) => claimGrants(userId, info)),
    settingsPromise,
    fetchHasPlayers(),
    getNavVisuals(),
    getStaffRole(userId),
    hasMfaEnabled(userId),
    settingsPromise.then((s) => fetchHasTeams(s.activeTournamentId)),
    settingsPromise.then((s) => fetchHasStatsContent(hasActiveContentOf(s))),
    fetchHasPodium(),
    getNameDecorations(),
  ]);
}

// ── Run ─────────────────────────────────────────────────────────────────────
const username = arg("user", null);
let accountQuery = db.from("accounts").select("discord_id, username, status");
accountQuery = username ? accountQuery.eq("username", username) : accountQuery.eq("status", "approved");
const { data: accounts } = await accountQuery.limit(1);
const account = accounts?.[0];
if (!account) {
  console.error(username ? `No account named ${username}` : "No approved account found");
  process.exit(1);
}

const stats = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
};
const ms = (n) => `${n.toFixed(0).padStart(5)} ms`;

console.log("=".repeat(70));
console.log("Dashboard chrome: waterfall vs bulk");
console.log("=".repeat(70));
console.log(`host     ${new URL(url).host}`);
console.log(`account  ${account.username} (${account.status})`);
console.log(`rounds   ${N} each, alternating so any network drift hits both equally`);
console.log();

await waterfall(account.discord_id); // warms DNS/TLS; deliberately not measured

const results = { waterfall: [], bulk: [] };
const counts = {};
for (let i = 0; i < N; i++) {
  for (const [name, run] of [
    ["waterfall", waterfall],
    ["bulk", bulk],
  ]) {
    queries = 0;
    const t = performance.now();
    await run(account.discord_id);
    results[name].push(performance.now() - t);
    counts[name] = queries;
  }
}

const w = stats(results.waterfall);
const b = stats(results.bulk);
console.log("                   min       median       max      queries");
console.log(`   waterfall  ${ms(w.min)}  ${ms(w.median)}  ${ms(w.max)}       ${counts.waterfall}`);
console.log(`   bulk       ${ms(b.min)}  ${ms(b.median)}  ${ms(b.max)}       ${counts.bulk}`);
console.log();
console.log(
  `   bulk saves ${ms(w.median - b.median)} at the median  (${(w.median / b.median).toFixed(2)}x faster)`,
);
if (counts.waterfall !== counts.bulk) {
  console.log("   WARNING: the modes issued different query counts - that is no longer an A/B.");
}
console.log();
console.log("Scheduling difference only, measured from this machine. Production is");
console.log("Vercel -> Supabase, a different network path: if the function region and");
console.log("the project region are far apart every round trip costs more, which widens");
console.log("this gap rather than narrowing it. For the end-to-end number read the");
console.log("[layout timing] line the layout prints to the dev-server console.");
