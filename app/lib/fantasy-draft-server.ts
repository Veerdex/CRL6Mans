import "server-only";
import { supabaseAdmin } from "./supabase";
import { recordNotification } from "./notifications";
import { isStatsTrackingEnabled } from "./career-stats";
import { isTestEventActive } from "./test-tournament";
import { normalizeTeamSize } from "./team-size";
import { developerDiscordIds } from "./players";
import { getCurrentFantasySeason } from "./fantasy-leagues";
import { currentSeasonTiers, frozenTiers } from "./fantasy-pool-data";
import { FANTASY_MIN_MANAGERS } from "./fantasy-rules";
import { TIER_LABEL, type FantasyTier } from "./fantasy-pool";
import {
  FANTASY_PICK_SECONDS,
  ROSTER_TIER_LIMITS,
  chooseAutopick,
  managerIndexForPick,
  poolShortfall,
  shuffled,
  slotForPick,
  tierCounts,
  tierNeeded,
  totalDraftPicks,
  type LineupSlot,
} from "./fantasy-draft";

// The fantasy draft's server side (docs/fantasy-rl.md §8): starting every
// league's draft, a pick, the autopick and its sweep. The rules themselves are
// in fantasy-draft.ts; the turn itself is claimed by fantasy_draft_pick
// (scripts/fantasy-draft-migration.sql).

export type DraftLeague = {
  id: string;
  fantasy_season_id: string;
  status: string;
  draft_order: string[] | null;
  current_pick: number;
  pick_deadline: string | null;
};

const DRAFT_COLS = "id, fantasy_season_id, status, draft_order, current_pick, pick_deadline";

export async function getDraftLeague(leagueId: string): Promise<DraftLeague | null> {
  const { data, error } = await supabaseAdmin.from("fantasy_leagues").select(DRAFT_COLS).eq("id", leagueId).maybeSingle();
  if (error || !data) return null;
  return data as DraftLeague;
}

export function managerOnClock(league: DraftLeague): string | null {
  const order = league.draft_order ?? [];
  if (league.status !== "drafting" || !order.length || league.current_pick >= totalDraftPicks(order.length)) return null;
  return order[managerIndexForPick(league.current_pick, order.length)];
}

async function leagueMemberIds(leagueId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId);
  return ((data ?? []) as { account_id: string }[]).map((m) => m.account_id);
}

export type RosterSlotRow = { manager_id: string; slot: LineupSlot; player_id: string };

export async function rosterSlots(leagueId: string): Promise<RosterSlotRow[]> {
  const { data } = await supabaseAdmin.from("fantasy_roster_slots").select("manager_id, slot, player_id").eq("league_id", leagueId);
  return (data ?? []) as RosterSlotRow[];
}

export type DraftPickRow = { pick_no: number; manager_id: string; player_id: string; auto: boolean };

export async function draftPicks(leagueId: string): Promise<DraftPickRow[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_draft_picks")
    .select("pick_no, manager_id, player_id, auto")
    .eq("league_id", leagueId)
    .order("pick_no");
  return (data ?? []) as DraftPickRow[];
}

async function discordIdsFor(accountIds: string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const { data } = await supabaseAdmin.from("accounts").select("discord_id").in("id", accountIds);
  return ((data ?? []) as { discord_id: string }[]).map((r) => r.discord_id);
}

// The real season can't start while a fantasy draft runs (§8), so the season
// moves to active the moment its last league finishes.
async function finishSeasonIfDrafted(fantasySeasonId: string) {
  const { count } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id", { count: "exact", head: true })
    .eq("fantasy_season_id", fantasySeasonId)
    .eq("status", "drafting");
  if (count === 0) {
    await supabaseAdmin.from("fantasy_seasons").update({ status: "active" }).eq("id", fantasySeasonId).eq("status", "drafting");
  }
}

type PickInput = { leagueId: string; managerId: string; playerId: string; auto: boolean };

export async function submitPick({ leagueId, managerId, playerId, auto }: PickInput): Promise<{ error?: string; done?: boolean }> {
  const league = await getDraftLeague(leagueId);
  if (!league || league.status !== "drafting") return { error: "This league isn't drafting." };
  const order = league.draft_order ?? [];
  const pick = league.current_pick;
  if (managerOnClock(league) !== managerId) return { error: "It isn't your pick." };

  const [tiers, members, slots] = await Promise.all([
    frozenTiers(league.fantasy_season_id),
    leagueMemberIds(leagueId),
    rosterSlots(leagueId),
  ]);
  const tierOf = new Map((tiers ?? []).map((t) => [t.player_id, t.tier]));
  const tier = tierOf.get(playerId);
  if (!tier || members.includes(playerId)) return { error: "That player isn't in this league's draft pool." };
  if (slots.some((s) => s.player_id === playerId)) return { error: "That player has already been drafted." };

  const mine = slots.filter((s) => s.manager_id === managerId);
  const counts = tierCounts(mine.map((s) => tierOf.get(s.player_id)).filter((t): t is FantasyTier => !!t));
  if (!tierNeeded(counts, tier)) {
    return { error: `You already have ${ROSTER_TIER_LIMITS[tier]} ${TIER_LABEL[tier]} players.` };
  }
  const slot = slotForPick(new Set(mine.map((s) => s.slot)), tier);
  if (!slot) return { error: "Your roster is full." };

  const testRun = await isTestRun(league.fantasy_season_id);
  const { data: outcome, error } = await supabaseAdmin.rpc("fantasy_draft_pick", {
    p_league: leagueId,
    p_pick: pick,
    p_manager: managerId,
    p_player: playerId,
    p_slot: slot,
    p_auto: auto,
    p_total: totalDraftPicks(order.length),
    p_seconds: pickSeconds(testRun),
  });
  if (error) return { error: "Couldn't make the pick." };
  if (outcome === "stale") return { error: "That pick has already been made." };
  if (outcome === "taken") return { error: "That player has already been drafted." };
  if (outcome === "done") await finishSeasonIfDrafted(league.fantasy_season_id);
  return { done: outcome === "done" };
}

/** Picks for whoever is on the clock if their time is up. True when a pick landed. */
export async function autopickIfDue(leagueId: string): Promise<boolean> {
  const league = await getDraftLeague(leagueId);
  const managerId = league ? managerOnClock(league) : null;
  if (!league || !managerId || !league.pick_deadline || new Date(league.pick_deadline).getTime() > Date.now()) return false;

  const [tiers, members, slots] = await Promise.all([
    frozenTiers(league.fantasy_season_id),
    leagueMemberIds(leagueId),
    rosterSlots(leagueId),
  ]);
  if (!tiers) return false;
  const taken = new Set([...members, ...slots.map((s) => s.player_id)]);
  const tierOf = new Map(tiers.map((t) => [t.player_id, t.tier]));
  const counts = tierCounts(
    slots.filter((s) => s.manager_id === managerId).map((s) => tierOf.get(s.player_id)).filter((t): t is FantasyTier => !!t),
  );
  const choice = chooseAutopick(
    tiers.filter((t) => !taken.has(t.player_id)).map((t) => ({ id: t.player_id, tier: t.tier, rating: t.rating })),
    counts,
  );
  if (!choice) return false;
  const res = await submitPick({ leagueId, managerId, playerId: choice.id, auto: true });
  return !res.error;
}

/** The cron's backstop for drafts nobody has open. */
export async function sweepFantasyAutopicks(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id")
    .eq("status", "drafting")
    .lte("pick_deadline", new Date().toISOString());
  if (error) return 0;
  let picks = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    // One pass per league, bounded: a pick restarts the clock, so a league
    // only owes more than one when its deadline was already long past.
    for (let i = 0; i < 3 && (await autopickIfDue(id)); i++) picks++;
  }
  return picks;
}

export async function startFantasyDrafts(): Promise<{ error?: string; message?: string }> {
  const season = await getCurrentFantasySeason();
  if (!season) return { error: "There's no fantasy season." };
  if (season.status !== "open") return { error: "This fantasy season's drafts have already started." };

  const [{ data: settings }, statsOn, testRun] = await Promise.all([
    supabaseAdmin.from("league_settings").select("team_size, draft_active, season_active").maybeSingle(),
    isStatsTrackingEnabled(),
    isTestEventActive(),
  ]);
  // §1: a 3v3 season with stats tracking; §8: after the real draft and before
  // Round 1. A test event gets a test run: see rollbackFantasyTestRun.
  if (normalizeTeamSize(settings?.team_size) !== 3) return { error: "Fantasy only runs alongside a 3v3 season." };
  if (!statsOn) return { error: "Turn stats tracking on first. Fantasy scores come from replay stats." };
  if (settings?.draft_active) return { error: "Finish the season draft first." };
  if (settings?.season_active) return { error: "The season has already started. Fantasy drafts run before Round 1." };

  const tiers = await currentSeasonTiers();
  if (!tiers.length) return { error: "Nobody is rostered yet. Run the season draft first." };

  // The claim: two staff pressing at once can't both start the drafts, and the
  // season leaving 'open' stops new leagues being created.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("fantasy_seasons")
    .update(testRun ? { status: "drafting", test_run: true } : { status: "drafting" })
    .eq("id", season.id)
    .eq("status", "open")
    .select("id");
  if (claimError && testRun) return { error: "Couldn't mark this as a test run. Has scripts/fantasy-test-run-migration.sql been run?" };
  if (!claimed?.length) return { error: "This fantasy season's drafts have already started." };

  // Leagues leave pre_draft before their members are read, since joining locks
  // on pre_draft: a manager joining after the read would otherwise be in a
  // league whose draft order doesn't include them. No order yet means nobody is
  // on the clock until the order is written below.
  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .update({ status: "drafting", draft_order: null, current_pick: 0, pick_deadline: null })
    .eq("fantasy_season_id", season.id)
    .eq("status", "pre_draft")
    .select("id, name");
  const leagues = (leagueRows ?? []) as { id: string; name: string }[];
  const revert = async () => {
    if (leagues.length) {
      await supabaseAdmin.from("fantasy_leagues").update({ status: "pre_draft" }).in("id", leagues.map((l) => l.id));
    }
    await supabaseAdmin
      .from("fantasy_seasons")
      .update(testRun ? { status: "open", test_run: false } : { status: "open" })
      .eq("id", season.id);
  };

  const { data: memberRows, error: memberError } = leagues.length
    ? await supabaseAdmin.from("fantasy_league_members").select("league_id, account_id").in("league_id", leagues.map((l) => l.id))
    : { data: [], error: null };
  if (memberError) {
    await revert();
    return { error: "Couldn't read the league members." };
  }
  const membersOf = new Map<string, string[]>(leagues.map((l) => [l.id, []]));
  for (const m of (memberRows ?? []) as { league_id: string; account_id: string }[]) membersOf.get(m.league_id)?.push(m.account_id);

  // A test run drafts only leagues made entirely of staff and test accounts,
  // and disbands nothing: every other league goes back to pre_draft untouched,
  // so the rollback at the end of the test has nothing it can't undo.
  const testSafe = testRun ? await staffOrTestAccounts([...membersOf.values()].flat()) : null;
  const sized = leagues.filter((l) => membersOf.get(l.id)!.length >= FANTASY_MIN_MANAGERS);
  const drafting = testSafe ? sized.filter((l) => membersOf.get(l.id)!.every((id) => testSafe.has(id))) : sized;
  const disbanding = testSafe ? [] : leagues.filter((l) => membersOf.get(l.id)!.length < FANTASY_MIN_MANAGERS);
  const untouched = testSafe ? leagues.filter((l) => !drafting.includes(l)) : [];
  if (testRun && !drafting.length) {
    await revert();
    return { error: "No league can run a test draft: one needs at least 4 managers, all of them staff or test accounts." };
  }

  // Refused up front rather than left to stall: a league whose pool can't fill
  // every roster would reach a pick with nobody legal to take.
  const short: string[] = [];
  for (const l of drafting) {
    const members = new Set(membersOf.get(l.id));
    const pool = tierCounts(tiers.filter((t) => !members.has(t.playerId)).map((t) => t.tier));
    const missing = poolShortfall(pool, members.size);
    if (missing.length) short.push(`${l.name} (${missing.map((t) => TIER_LABEL[t]).join(", ")})`);
  }
  if (short.length) {
    await revert();
    return { error: `Not enough players to fill every roster in: ${short.join("; ")}.` };
  }

  const rows = tiers.map((t) => ({ fantasy_season_id: season.id, player_id: t.playerId, tier: t.tier, rating: t.rating }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("fantasy_player_tiers").upsert(rows.slice(i, i + 500));
    if (error) {
      await revert();
      return { error: "Couldn't save the player tiers. Has scripts/fantasy-draft-migration.sql been run?" };
    }
  }

  if (untouched.length) {
    await supabaseAdmin.from("fantasy_leagues").update({ status: "pre_draft" }).in("id", untouched.map((l) => l.id));
  }
  const deadline = new Date(Date.now() + pickSeconds(testRun) * 1000).toISOString();
  for (const l of drafting) {
    await supabaseAdmin
      .from("fantasy_leagues")
      .update({ draft_order: shuffled(membersOf.get(l.id)!), current_pick: 0, pick_deadline: deadline })
      .eq("id", l.id);
  }
  if (disbanding.length) {
    await supabaseAdmin.from("fantasy_leagues").update({ status: "disbanded" }).in("id", disbanding.map((l) => l.id));
  }
  if (!drafting.length) {
    await supabaseAdmin.from("fantasy_seasons").update({ status: "active" }).eq("id", season.id);
  }

  for (const l of drafting) {
    const discordIds = await discordIdsFor(membersOf.get(l.id)!);
    if (discordIds.length) {
      await recordNotification(
        { kind: "users", discordIds },
        { title: "Fantasy draft started", body: `The ${l.name} draft is live.`, url: `/dashboard/fantasy/${l.id}/draft` },
      );
    }
  }
  for (const l of disbanding) {
    const discordIds = await discordIdsFor(membersOf.get(l.id)!);
    if (discordIds.length) {
      await recordNotification(
        { kind: "users", discordIds },
        {
          title: "Fantasy league disbanded",
          body: `${l.name} had fewer than ${FANTASY_MIN_MANAGERS} managers when the drafts started, so it was disbanded.`,
          url: "/dashboard/fantasy",
        },
      );
    }
  }

  return {
    message: `Started ${drafting.length} ${testRun ? "test " : ""}draft${drafting.length === 1 ? "" : "s"}${
      disbanding.length ? `, disbanded ${disbanding.length} league${disbanding.length === 1 ? "" : "s"}` : ""
    }${untouched.length ? `, left ${untouched.length} league${untouched.length === 1 ? "" : "s"} waiting` : ""}.`,
  };
}

// Test-account managers can't log in, so every one of their picks is an
// autopick; at the real clock a test draft would take hours.
const TEST_PICK_SECONDS = 30;

function pickSeconds(testRun: boolean): number {
  return testRun ? TEST_PICK_SECONDS : FANTASY_PICK_SECONDS;
}

async function isTestRun(fantasySeasonId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("fantasy_seasons").select("test_run").eq("id", fantasySeasonId).maybeSingle();
  return !error && data?.test_run === true;
}

async function staffOrTestAccounts(accountIds: string[]): Promise<Set<string>> {
  if (!accountIds.length) return new Set();
  const [{ data: accounts }, { data: staff }] = await Promise.all([
    supabaseAdmin.from("accounts").select("id, discord_id").in("id", [...new Set(accountIds)]),
    supabaseAdmin.from("staff_roles").select("discord_id"),
  ]);
  const staffIds = new Set([...((staff ?? []) as { discord_id: string }[]).map((s) => s.discord_id), ...developerDiscordIds()]);
  return new Set(
    ((accounts ?? []) as { id: string; discord_id: string }[])
      .filter((a) => a.discord_id.startsWith("test_") || staffIds.has(a.discord_id))
      .map((a) => a.id),
  );
}

/**
 * Undoes a fantasy test run when the test event ends (resetSeason): its picks,
 * rosters and frozen tiers go, its leagues return to pre_draft and the season to
 * open, so the real season's drafts start from nothing. A no-op otherwise.
 */
export async function rollbackFantasyTestRun(): Promise<void> {
  const season = await getCurrentFantasySeason();
  if (!season || !(await isTestRun(season.id))) return;
  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id")
    .eq("fantasy_season_id", season.id)
    .in("status", ["drafting", "active"]);
  const ids = ((leagueRows ?? []) as { id: string }[]).map((l) => l.id);
  if (ids.length) {
    await supabaseAdmin.from("fantasy_slot_credits").delete().in("league_id", ids);
    await supabaseAdmin.from("fantasy_roster_slots").delete().in("league_id", ids);
    await supabaseAdmin.from("fantasy_draft_picks").delete().in("league_id", ids);
    await supabaseAdmin.from("fantasy_waiver_claims").delete().in("league_id", ids);
    await supabaseAdmin.from("fantasy_waivers").delete().in("league_id", ids);
    await supabaseAdmin.from("fantasy_trades").delete().in("league_id", ids);
    await supabaseAdmin
      .from("fantasy_leagues")
      .update({ status: "pre_draft", draft_order: null, current_pick: 0, pick_deadline: null, waiver_order: null, waivers_ran_at: null })
      .in("id", ids);
  }
  await supabaseAdmin.from("fantasy_player_tiers").delete().eq("fantasy_season_id", season.id);
  await supabaseAdmin.from("fantasy_seasons").update({ status: "open", test_run: false }).eq("id", season.id);
}
