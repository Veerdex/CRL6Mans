import "server-only";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./paginate";
import { GROUP_STAGE_PREFIX } from "./bracket";
import { getPoolView, type PoolPlayer } from "./fantasy-pool-data";
import { seriesPointsFromGames } from "./fantasy-pool";
import { LINEUP_SLOTS, isStarterSlot, type LineupSlot } from "./fantasy-draft";
import { buildSchedule, currentWeek, type Schedule } from "./fantasy-schedule";

// The Matchup tab's data (docs/fantasy-rl.md §5–§7). A slot's score comes from
// its credit (fantasy-credits.ts), and the points behind it are computed here on
// read, so a stat edit or a re-reported series flows through on the next load.

export type SlotState =
  | { kind: "scored"; points: number; forfeit: boolean }
  | { kind: "live" }
  | { kind: "upcoming"; opponent: string | null; at: string | null }
  | { kind: "bye" }
  | { kind: "forfeit" }
  | { kind: "spent" }
  | { kind: "ineligible" }
  | { kind: "missed" }
  | { kind: "empty" };

export type SlotLine = { slot: LineupSlot; player: PoolPlayer | null; state: SlotState };

export type ManagerWeek = { total: number; starters: SlotLine[]; bench: SlotLine[] };

export type MatchupData = {
  hiddenForTest: boolean;
  schedule: Schedule;
  /** The earliest open week, and the week the lineups are for. */
  currentWeek: number | null;
  shownWeek: number | null;
  /** The managers in draft order, which is the round robin's seating. */
  managers: string[];
  /** Every manager's lineup for the week asked for. */
  lineups: Map<string, ManagerWeek>;
};

type GroupMatch = {
  id: string;
  round: number | null;
  status: string;
  forfeit: boolean | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  scheduled_at: string | null;
};

type Credit = { manager_id: string; week: number; slot: LineupSlot; player_id: string; match_id: string; team_id: string };

const FINAL_STATUSES = new Set(["completed", "cancelled"]);

export async function getMatchupData(leagueId: string, viewerIsStaff: boolean, week: number | null): Promise<MatchupData> {
  const [{ data: league }, { data: memberRows }, pool, matches, credits, { data: slotRows }, { data: teamRows }] = await Promise.all([
    supabaseAdmin.from("fantasy_leagues").select("draft_order").eq("id", leagueId).maybeSingle(),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId).order("joined_at"),
    getPoolView(leagueId, viewerIsStaff),
    fetchAllRows<GroupMatch>((from, to) =>
      supabaseAdmin
        .from("matches")
        .select("id, round, status, forfeit, home_team_id, away_team_id, home_score, away_score, scheduled_at")
        .like("stage", `${GROUP_STAGE_PREFIX}%`)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<Credit>((from, to) =>
      supabaseAdmin
        .from("fantasy_slot_credits")
        .select("manager_id, week, slot, player_id, match_id, team_id")
        .eq("league_id", leagueId)
        .order("week")
        .order("manager_id")
        .order("slot")
        .range(from, to),
    ).catch(() => [] as Credit[]),
    supabaseAdmin.from("fantasy_roster_slots").select("manager_id, slot, player_id").eq("league_id", leagueId),
    supabaseAdmin.from("teams").select("id, name"),
  ]);

  const members = ((memberRows ?? []) as { account_id: string }[]).map((m) => m.account_id);
  const order = ((league?.draft_order as string[] | null) ?? []).filter((id) => members.includes(id));
  const managers = [...order, ...members.filter((id) => !order.includes(id))];

  const empty: MatchupData = {
    hiddenForTest: pool.hiddenForTest,
    schedule: { weeks: [], standings: [], champion: null },
    currentWeek: null,
    shownWeek: null,
    managers,
    lineups: new Map(),
  };
  if (pool.hiddenForTest) return empty;

  const matchById = new Map(matches.map((m) => [m.id, m]));
  const totalWeeks = matches.reduce((max, m) => Math.max(max, m.round ?? 0), 0);
  const closedWeeks = new Set<number>();
  for (let w = 1; w <= totalWeeks; w++) {
    const round = matches.filter((m) => m.round === w);
    if (round.length && round.every((m) => FINAL_STATUSES.has(m.status))) closedWeeks.add(w);
  }

  const creditedMatches = [...new Set(credits.map((c) => c.match_id))];
  const creditedPlayers = [...new Set(credits.map((c) => c.player_id))];
  const stats = creditedMatches.length
    ? await fetchAllRows<{ match_id: string; player_id: string; goals: number; assists: number; saves: number; shots: number; score: number }>(
        (from, to) =>
          supabaseAdmin
            .from("player_game_stats")
            .select("match_id, player_id, goals, assists, saves, shots, score")
            .in("match_id", creditedMatches)
            .in("player_id", creditedPlayers)
            .order("id")
            .range(from, to),
      )
    : [];
  const gamesOf = new Map<string, typeof stats>();
  for (const r of stats) {
    const key = `${r.player_id}:${r.match_id}`;
    const list = gamesOf.get(key);
    if (list) list.push(r);
    else gamesOf.set(key, [r]);
  }

  const creditPoints = (c: Credit): { points: number; forfeit: boolean } => {
    const m = matchById.get(c.match_id);
    if (!m) return { points: 0, forfeit: false };
    const forfeit = !!m.forfeit;
    const home = m.home_team_id === c.team_id;
    return {
      forfeit,
      points: seriesPointsFromGames(gamesOf.get(`${c.player_id}:${c.match_id}`) ?? [], {
        forfeit,
        ownScore: (home ? m.home_score : m.away_score) ?? 0,
        oppScore: (home ? m.away_score : m.home_score) ?? 0,
      }),
    };
  };

  const weekTotals = new Map<string, number>();
  const creditAt = new Map<string, Credit>();
  for (const c of credits) {
    creditAt.set(`${c.week}:${c.manager_id}:${c.slot}`, c);
    const key = `${c.week}:${c.manager_id}`;
    weekTotals.set(key, (weekTotals.get(key) ?? 0) + creditPoints(c).points);
  }

  const schedule = buildSchedule({
    managers,
    totalWeeks,
    closedWeeks,
    points: (w, m) => weekTotals.get(`${w}:${m}`) ?? 0,
  });
  const current = currentWeek(schedule.weeks);
  const shownWeek = week !== null && week >= 1 && week <= totalWeeks ? week : current;
  if (shownWeek === null) return { ...empty, schedule, currentWeek: current };

  const playerById = new Map(pool.players.map((p) => [p.id, p]));
  const teamName = new Map(((teamRows ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const matchOfTeam = new Map<string, GroupMatch>();
  for (const m of matches) {
    if (m.round !== shownWeek) continue;
    if (m.home_team_id) matchOfTeam.set(m.home_team_id, m);
    if (m.away_team_id) matchOfTeam.set(m.away_team_id, m);
  }
  const now = Date.now();
  const closed = closedWeeks.has(shownWeek);

  // A slot nobody has scored in yet, read off whoever sits in it now.
  const openState = (player: PoolPlayer | null): SlotState => {
    if (!player) return { kind: "empty" };
    const teamId = player.team?.id;
    if (!teamId) return { kind: "ineligible" };
    const m = matchOfTeam.get(teamId);
    if (!m) return { kind: "bye" };
    if (m.status === "completed") return m.forfeit ? { kind: "forfeit" } : { kind: "spent" };
    if (m.status === "cancelled") return { kind: "bye" };
    if (m.scheduled_at && new Date(m.scheduled_at).getTime() <= now) return { kind: "live" };
    const opponentId = m.home_team_id === teamId ? m.away_team_id : m.home_team_id;
    return { kind: "upcoming", opponent: opponentId ? teamName.get(opponentId) ?? null : null, at: m.scheduled_at };
  };

  const occupant = new Map(
    ((slotRows ?? []) as { manager_id: string; slot: LineupSlot; player_id: string }[]).map((s) => [`${s.manager_id}:${s.slot}`, s.player_id]),
  );
  const lineups = new Map<string, ManagerWeek>();
  for (const managerId of managers) {
    const starters: SlotLine[] = [];
    const bench: SlotLine[] = [];
    for (const slot of LINEUP_SLOTS) {
      const sitting = occupant.get(`${managerId}:${slot}`);
      const sittingPlayer = sitting ? playerById.get(sitting) ?? null : null;
      if (!isStarterSlot(slot)) {
        if (!closed) bench.push({ slot, player: sittingPlayer, state: openState(sittingPlayer) });
        continue;
      }
      const credit = creditAt.get(`${shownWeek}:${managerId}:${slot}`);
      if (credit) {
        const { points, forfeit } = creditPoints(credit);
        starters.push({ slot, player: playerById.get(credit.player_id) ?? null, state: { kind: "scored", points, forfeit } });
      } else if (closed) {
        starters.push({ slot, player: null, state: { kind: "missed" } });
      } else {
        starters.push({ slot, player: sittingPlayer, state: openState(sittingPlayer) });
      }
    }
    lineups.set(managerId, { total: weekTotals.get(`${shownWeek}:${managerId}`) ?? 0, starters, bench });
  }

  return { hiddenForTest: false, schedule, currentWeek: current, shownWeek, managers, lineups };
}
