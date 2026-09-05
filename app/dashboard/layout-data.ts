import { getPlayerInfo, getStaffRole, hasMfaEnabled, type StaffRole } from "@/app/lib/players";
import { getNavVisuals, type NavVisuals } from "@/app/lib/sponsors-public";
import { supabaseAdmin } from "@/app/lib/supabase";
import { hasAnyCareerStats } from "@/app/lib/career-stats";
import { getNameDecorations } from "@/app/lib/patreon-entitlements";
import { type NavTabOverrides } from "@/app/lib/nav-tabs";

// ── The switch ────────────────────────────────────────────────────────────────
// How the dashboard chrome fetches its data. Change it here, in code — there is
// deliberately no admin control or env var, because the point is to A/B the two
// schedules against each other, not to let them drift apart in production.
//
//   "waterfall"  Await in stages, the way this ran before: player info, then the
//                coin grant, then settings/staff, then the nav-visibility
//                checks, then the name decorations. Each stage waits for the one
//                before it even when it does not depend on it.
//   "bulk"       Start every chain at once and await them together. A chain that
//                genuinely depends on another (the nav-visibility checks need
//                active_tournament_id; the coin grant needs the player's status)
//                still waits for just that one, not for the whole stage.
//
// Both modes issue exactly the same queries and return the same bundle — only
// the scheduling differs, which is what makes the comparison mean anything.
//
// Roughly 2x, not 10x - Node's fetch opens a fresh TCP+TLS connection per
// concurrent request, so connection setup rather than round-trip count is what
// bounds bulk mode. `npm run bench:layout-modes` measures the two schedules
// against the real database; on 2026-09-04 it read 1395ms median for waterfall
// against 654ms for bulk, 17 queries either way. Re-run it after changing what
// the chrome fetches - equal query counts are what make the comparison honest.
export type LoadMode = "waterfall" | "bulk";
export const LOAD_MODE: LoadMode = "bulk";

// Isolated from any component body so React's purity lint sees a plain function
// call rather than a side effect.
const perfNow = () => performance.now();

type Settings = {
  seasonActive: boolean;
  draftActive: boolean;
  activeTournamentId: string | null;
  statsEnabled: boolean;
  navTabOverrides: NavTabOverrides;
};

type CoinGrants = {
  coinGrantStart: number;
  coinGrantWeekly: number;
  teamSignupMessage: string | null;
};

export type DashboardChromeData = CoinGrants & {
  playerInfo: Awaited<ReturnType<typeof getPlayerInfo>>;
  settings: Settings;
  hasPlayers: boolean;
  navSponsors: NavVisuals;
  staffRole: StaffRole | null;
  mfaOk: boolean;
  hasTeams: boolean;
  hasStatsContent: boolean;
  hasPodium: boolean;
  decorations: Awaited<ReturnType<typeof getNameDecorations>>;
};

async function fetchSettings(): Promise<Settings> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("draft_active, season_active, active_tournament_id, stats_enabled, nav_tab_overrides")
    .single();
  return {
    seasonActive: data?.season_active ?? false,
    draftActive: data?.draft_active ?? false,
    activeTournamentId: (data?.active_tournament_id as string | null) ?? null,
    statsEnabled: data?.stats_enabled ?? true,
    navTabOverrides: (data?.nav_tab_overrides as NavTabOverrides | null) ?? {},
  };
}

async function fetchHasPlayers(): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("status", "approved")
    .eq("draft_entered", true);
  return (count ?? 0) > 0;
}

// ── Claim pending coin grants on visit ───────────────────────────────────────
// crl_coins/coin_grant_pending_* live on accounts (Tier 1) so unregistered and
// pending guests can wager too, not just approved players. Rejected accounts are
// excluded to match the wagering gate (accounts.status !== "rejected").
// team_signup_not_selected/too_few_players stay on players (Tier 3) — they only
// make sense for someone who was actually on a roster.
//
// This is the one part of the bundle that writes, so it must never be started
// speculatively. Banned is gated here rather than relying on the layout's
// redirect: under "bulk" this runs concurrently with everything else, so the
// redirect no longer happens first and a banned account would otherwise burn its
// pending grant on the way out.
async function claimGrants(
  userId: string,
  playerInfo: Awaited<ReturnType<typeof getPlayerInfo>>,
): Promise<CoinGrants> {
  const blank: CoinGrants = { coinGrantStart: 0, coinGrantWeekly: 0, teamSignupMessage: null };
  if (playerInfo.status === "rejected" || playerInfo.status === "banned" || playerInfo.isGuest) {
    return blank;
  }

  const grants = { ...blank };

  const { data: accountCoins } = await supabaseAdmin
    .from("accounts")
    .select("id, crl_coins, coin_grant_pending_start, coin_grant_pending_weekly")
    .eq("discord_id", userId)
    .single();

  const pendingStart = accountCoins?.coin_grant_pending_start ?? false;
  const pendingWeekly = accountCoins?.coin_grant_pending_weekly ?? false;

  if ((pendingStart || pendingWeekly) && accountCoins) {
    const { data: ls } = await supabaseAdmin
      .from("league_settings")
      .select("pending_start_coin_amount")
      .single();

    const startAmount = pendingStart ? ((ls?.pending_start_coin_amount as number | null) ?? 0) : 0;
    const weeklyAmount = pendingWeekly ? 250 : 0;
    const total = startAmount + weeklyAmount;

    if (total > 0) {
      await supabaseAdmin
        .from("accounts")
        .update({
          crl_coins: (accountCoins.crl_coins ?? 0) + total,
          coin_grant_pending_start: false,
          coin_grant_pending_weekly: false,
        })
        .eq("id", accountCoins.id);
      grants.coinGrantStart = startAmount;
      grants.coinGrantWeekly = weeklyAmount;
    }
  }

  if (playerInfo.status === "approved") {
    const { data: playerFlags } = await supabaseAdmin
      .from("players")
      .select("id, team_signup_not_selected, team_signup_too_few_players")
      .eq("discord_id", userId)
      .single();

    if (playerFlags?.team_signup_not_selected) {
      grants.teamSignupMessage = "Your team didn't make the cutoff for the last tournament you signed up for.";
      await supabaseAdmin.from("players").update({ team_signup_not_selected: false }).eq("id", playerFlags.id);
    } else if (playerFlags?.team_signup_too_few_players) {
      grants.teamSignupMessage = "Your team didn't reach the 3-player minimum in time, so it wasn't entered in the last tournament.";
      await supabaseAdmin.from("players").update({ team_signup_too_few_players: false }).eq("id", playerFlags.id);
    }
  }

  return grants;
}

// Determine whether the Teams page would show any teams in the current context.
// Active tournament: check if any player who entered it has been placed on a team.
// Otherwise: check if any team has at least one player assigned (browsable any time).
async function fetchHasTeams(activeTournamentId: string | null): Promise<boolean> {
  if (activeTournamentId) {
    const { data: entries } = await supabaseAdmin
      .from("tournament_entries")
      .select("player_id")
      .eq("tournament_id", activeTournamentId);
    if ((entries ?? []).length === 0) return false;
    const entryIds = (entries ?? []).map((e: { player_id: string }) => e.player_id);
    const { count: teamedCount } = await supabaseAdmin
      .from("players")
      .select("*", { count: "exact", head: true })
      .in("id", entryIds)
      .not("team_id", "is", null);
    return (teamedCount ?? 0) > 0;
  }
  const { count: teamedCount } = await supabaseAdmin
    .from("players")
    .select("*", { count: "exact", head: true })
    .not("team_id", "is", null);
  return (teamedCount ?? 0) > 0;
}

// player_game_stats only ever holds the live event (match_id cascades on the
// delete resetSeason runs), so the all-time record lives in player_career_stats.
// The tab shows while a stats-tracking event is live, and otherwise whenever
// either store has anything in it — including through the gap between events.
// An event with stats disabled contributes nothing, but past totals still do.
async function fetchHasStatsContent(hasActiveTrackedContent: boolean): Promise<boolean> {
  if (hasActiveTrackedContent) return true;
  const [{ count: liveCount }, anyCareer] = await Promise.all([
    supabaseAdmin.from("player_game_stats").select("*", { count: "exact", head: true }).limit(1),
    hasAnyCareerStats(),
  ]);
  return (liveCount ?? 0) > 0 || anyCareer;
}

// Podium nav only shows when there's a non-hidden completed event with a champion.
async function fetchHasPodium(): Promise<boolean> {
  const [{ data: podSeasons }, { data: podTournaments }] = await Promise.all([
    supabaseAdmin.from("seasons").select("summary").eq("hidden_from_home", false).limit(20),
    supabaseAdmin.from("tournaments").select("summary").eq("status", "completed").eq("hidden_from_home", false).limit(20),
  ]);
  const anyChamp = (rows: { summary: unknown }[] | null) =>
    (rows ?? []).some((r) => !!(r.summary as { champion?: string | null } | null)?.champion);
  return anyChamp(podSeasons) || anyChamp(podTournaments);
}

const hasActiveContentOf = (s: Settings) => s.seasonActive || !!s.activeTournamentId;
const hasTrackedContentOf = (s: Settings) => hasActiveContentOf(s) && s.statsEnabled;

async function loadWaterfall(userId: string): Promise<DashboardChromeData> {
  const t0 = perfNow();

  // Kicked off here but not awaited until after the coin grant, which is what
  // makes this the waterfall: the stages below wait on each other in order.
  const settingsPromise = fetchSettings();
  const hasPlayersPromise = fetchHasPlayers();
  const navSponsorsPromise = getNavVisuals();
  const staffRolePromise = getStaffRole(userId);
  const mfaOkPromise = hasMfaEnabled(userId);

  const playerInfo = await getPlayerInfo(userId);
  const tPlayerInfo = perfNow();

  const grants = await claimGrants(userId, playerInfo);

  const [settings, hasPlayers, navSponsors, staffRole, mfaOk] = await Promise.all([
    settingsPromise,
    hasPlayersPromise,
    navSponsorsPromise,
    staffRolePromise,
    mfaOkPromise,
  ]);
  const tSettings = perfNow();

  const [hasTeams, hasStatsContent, hasPodium] = await Promise.all([
    fetchHasTeams(settings.activeTournamentId),
    fetchHasStatsContent(hasTrackedContentOf(settings)),
    fetchHasPodium(),
  ]);
  const tNav = perfNow();

  const decorations = await getNameDecorations();
  const tEnd = perfNow();

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[layout timing] mode=waterfall · playerInfo ${(tPlayerInfo - t0).toFixed(0)}ms · ` +
      `+settings/staff/coin ${(tSettings - tPlayerInfo).toFixed(0)}ms · ` +
      `+nav-visibility ${(tNav - tSettings).toFixed(0)}ms · ` +
      `+decorations ${(tEnd - tNav).toFixed(0)}ms · ` +
      `total ${(tEnd - t0).toFixed(0)}ms`
    );
  }

  return { playerInfo, ...grants, settings, hasPlayers, navSponsors, staffRole, mfaOk, hasTeams, hasStatsContent, hasPodium, decorations };
}

async function loadBulk(userId: string): Promise<DashboardChromeData> {
  const t0 = perfNow();

  // One settings promise shared by everyone who needs it, so chaining off it
  // costs a dependency rather than a second query.
  const settingsPromise = fetchSettings();
  const playerInfoPromise = getPlayerInfo(userId);

  const [
    playerInfo,
    grants,
    settings,
    hasPlayers,
    navSponsors,
    staffRole,
    mfaOk,
    hasTeams,
    hasStatsContent,
    hasPodium,
    decorations,
  ] = await Promise.all([
    playerInfoPromise,
    playerInfoPromise.then((info) => claimGrants(userId, info)),
    settingsPromise,
    fetchHasPlayers(),
    getNavVisuals(),
    getStaffRole(userId),
    hasMfaEnabled(userId),
    settingsPromise.then((s) => fetchHasTeams(s.activeTournamentId)),
    settingsPromise.then((s) => fetchHasStatsContent(hasTrackedContentOf(s))),
    fetchHasPodium(),
    getNameDecorations(),
  ]);

  if (process.env.NODE_ENV !== "production") {
    console.log(`[layout timing] mode=bulk · total ${(perfNow() - t0).toFixed(0)}ms`);
  }

  return { playerInfo, ...grants, settings, hasPlayers, navSponsors, staffRole, mfaOk, hasTeams, hasStatsContent, hasPodium, decorations };
}

export function loadDashboardChrome(userId: string): Promise<DashboardChromeData> {
  return LOAD_MODE === "bulk" ? loadBulk(userId) : loadWaterfall(userId);
}
