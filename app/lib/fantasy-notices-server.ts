import "server-only";
import { supabaseAdmin } from "./supabase";
import { isTestEventActive } from "./test-tournament";
import { isStarterSlot, type LineupSlot } from "./fantasy-draft";
import { buildSchedule, currentWeek, weekLabel } from "./fantasy-schedule";
import { groupMatches, leagueCredits, scoreCredits, seatOrder, weeksOf, type GroupMatch } from "./fantasy-matchup-server";
import { accountNames, notifyManagers } from "./fantasy-notify";
import { lineupNotice, scheduleNotices, type KeyedNotices } from "./fantasy-notices";

// The notices nothing happens at the moment of (docs/fantasy-rl.md §12): a week
// closes when its last series is reported, and a starter's bye is a fact about
// the week rather than an event. Each cron tick derives what is due and
// fantasy_notices (scripts/fantasy-notices-migration.sql) remembers what was
// sent, so each goes out once per league.

const BASELINE = "baseline";

type League = { id: string; name: string; fantasy_season_id: string; draft_order: string[] | null };

/** Claims keys in the sent log, returning only the ones this call inserted. */
async function claim(leagueId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data, error } = await supabaseAdmin
    .from("fantasy_notices")
    .upsert(keys.map((key) => ({ league_id: leagueId, key })), { onConflict: "league_id,key", ignoreDuplicates: true })
    .select("key");
  if (error) throw new Error(`claiming notices: ${error.message}`);
  return new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
}

export async function runFantasyNotices(): Promise<string[]> {
  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id, name, fantasy_season_id, draft_order")
    .eq("status", "active");
  let leagues = (leagueRows ?? []) as League[];
  if (!leagues.length) return [];
  // During a test event the group stage is the test's, so only a test run's
  // leagues, which are all staff and test accounts, are scored against it.
  if (await isTestEventActive()) {
    const { data: seasons } = await supabaseAdmin
      .from("fantasy_seasons")
      .select("id")
      .in("id", [...new Set(leagues.map((l) => l.fantasy_season_id))])
      .eq("test_run", true);
    const testSeasons = new Set(((seasons ?? []) as { id: string }[]).map((s) => s.id));
    leagues = leagues.filter((l) => testSeasons.has(l.fantasy_season_id));
    if (!leagues.length) return [];
  }
  const ids = leagues.map((l) => l.id);

  const [matches, { data: sentRows, error: sentError }, { data: memberRows }] = await Promise.all([
    groupMatches(),
    supabaseAdmin.from("fantasy_notices").select("league_id, key").in("league_id", ids),
    supabaseAdmin.from("fantasy_league_members").select("league_id, account_id").in("league_id", ids).order("joined_at"),
  ]);
  if (sentError) return [];
  const sent = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const r of (sentRows ?? []) as { league_id: string; key: string }[]) sent.get(r.league_id)?.add(r.key);
  const membersOf = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const m of (memberRows ?? []) as { league_id: string; account_id: string }[]) membersOf.get(m.league_id)?.push(m.account_id);

  const { totalWeeks, closedWeeks } = weeksOf(matches);
  if (!totalWeeks) return [];
  const fired: string[] = [];
  for (const league of leagues) {
    const managers = seatOrder(league.draft_order, membersOf.get(league.id)!);
    await sweepLeague(league, managers, matches, totalWeeks, closedWeeks, sent.get(league.id)!)
      .then((lines) => fired.push(...lines))
      .catch((e: unknown) => console.error(`[fantasy] notices for ${league.id} failed: ${e instanceof Error ? e.message : String(e)}`));
  }
  return fired;
}

async function sweepLeague(
  league: League,
  managers: string[],
  matches: GroupMatch[],
  totalWeeks: number,
  closedWeeks: Set<number>,
  sent: Set<string>,
): Promise<string[]> {
  // Which weeks are due depends only on which have closed, so no scores are
  // read until there is something new to say.
  const shape = buildSchedule({ managers, totalWeeks, closedWeeks, points: () => 0 });
  const dueKeys = scheduleNotices(shape, "", () => "").map((k) => k.key);
  const fired: string[] = [];

  // First sight of a league, such as the deploy that adds this: what is
  // already due is history, so it is marked sent rather than sent.
  if (!sent.has(BASELINE)) {
    await claim(league.id, [BASELINE, ...dueKeys]);
    dueKeys.forEach((k) => sent.add(k));
  }

  if (dueKeys.some((k) => !sent.has(k))) {
    const { weekTotals } = await scoreCredits(matches, await leagueCredits(league.id));
    const schedule = buildSchedule({ managers, totalWeeks, closedWeeks, points: (w, m) => weekTotals.get(`${w}:${m}`) ?? 0 });
    const names = await accountNames(managers);
    const due = scheduleNotices(schedule, league.name, (id) => names.get(id) ?? "Unknown").filter((k) => !sent.has(k.key));
    const won = await claim(league.id, due.map((k) => k.key));
    for (const k of due.filter((k) => won.has(k.key))) {
      send(league, k);
      fired.push(`notices:${league.id}:${k.key}`);
    }
  }

  fired.push(...(await lineupAlerts(league, shape.weeks, matches, sent)));
  return fired;
}

function send(league: League, k: KeyedNotices) {
  const url = `/dashboard/fantasy/${league.id}/matchup`;
  for (const n of k.notices) notifyManagers(n.to, "fantasy_results", { title: n.title, body: n.body, url });
}

// §12: a starter who won't score this week, while there's still time to swap
// them out. Only for managers with an opponent that week, and only for a
// starter who hasn't already scored in it.
async function lineupAlerts(
  league: League,
  weeks: ReturnType<typeof buildSchedule>["weeks"],
  matches: GroupMatch[],
  sent: Set<string>,
): Promise<string[]> {
  const w = currentWeek(weeks);
  const week = weeks.find((x) => x.week === w);
  if (!week || week.closed || week.pending) return [];
  const round = matches.filter((m) => m.round === week.week);
  if (!round.length) return [];
  const playing = new Set(week.matchups.filter((m) => m.b !== null).flatMap((m) => [m.a, m.b!]));
  if (!playing.size) return [];

  const [{ data: slotRows }, { data: creditRows }] = await Promise.all([
    supabaseAdmin.from("fantasy_roster_slots").select("manager_id, slot, player_id").eq("league_id", league.id),
    supabaseAdmin.from("fantasy_slot_credits").select("manager_id, slot").eq("league_id", league.id).eq("week", week.week),
  ]);
  const credited = new Set(((creditRows ?? []) as { manager_id: string; slot: string }[]).map((c) => `${c.manager_id}:${c.slot}`));
  const starters = ((slotRows ?? []) as { manager_id: string; slot: LineupSlot; player_id: string }[]).filter(
    (s) => isStarterSlot(s.slot) && playing.has(s.manager_id) && !credited.has(`${s.manager_id}:${s.slot}`),
  );
  if (!starters.length) return [];
  const { data: playerRows } = await supabaseAdmin
    .from("players")
    .select("id, team_id")
    .in("id", starters.map((s) => s.player_id));
  const teamOf = new Map(((playerRows ?? []) as { id: string; team_id: string | null }[]).map((p) => [p.id, p.team_id]));
  const liveMatch = new Map<string, GroupMatch>();
  for (const m of round) {
    if (m.status === "cancelled") continue;
    if (m.home_team_id) liveMatch.set(m.home_team_id, m);
    if (m.away_team_id) liveMatch.set(m.away_team_id, m);
  }

  const items = starters.flatMap((s) => {
    const team = teamOf.get(s.player_id) ?? null;
    const reason: "bye" | "ineligible" | null = !team ? "ineligible" : liveMatch.has(team) ? null : "bye";
    return reason ? [{ ...s, reason, key: `lineup:${week.week}:${s.manager_id}:${s.player_id}:${reason}` }] : [];
  });
  const fresh = items.filter((i) => !sent.has(i.key));
  if (!fresh.length) return [];
  const won = await claim(league.id, fresh.map((i) => i.key));
  const claimed = fresh.filter((i) => won.has(i.key));
  if (!claimed.length) return [];

  const names = await accountNames(claimed.map((i) => i.player_id));
  const byManager = new Map<string, typeof claimed>();
  for (const i of claimed) byManager.set(i.manager_id, [...(byManager.get(i.manager_id) ?? []), i]);
  for (const [managerId, list] of byManager) {
    const { title, body } = lineupNotice(
      league.name,
      weekLabel(week),
      list.map((i) => ({ player: names.get(i.player_id) ?? "A player", reason: i.reason })),
    );
    notifyManagers([managerId], "fantasy_lineup", { title, body, url: `/dashboard/fantasy/${league.id}/roster` });
  }
  return [...byManager.keys()].map((m) => `lineup:${league.id}:${m}`);
}
