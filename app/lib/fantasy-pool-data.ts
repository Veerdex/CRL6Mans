import "server-only";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./paginate";
import { fetchAllTimeTotals, isStatsTrackingEnabled } from "./career-stats";
import { isTestEventActive } from "./test-tournament";
import {
  decisionRatingFromRow,
  resolveTeamRating,
  rulesRatingFromRow,
  shownRatingFromRow,
  type PlayerRatingRow,
} from "./rating";
import { hasMmrOnFile } from "./mmr-on-file";
import { resolveBestOf, type BestOf, type RoundBestOfConfig } from "@/app/dashboard/season/format-constants";
import {
  freeAgentTier,
  projectedSeriesPoints,
  projectionBasis,
  seriesPointsFromGames,
  tierFromDraftRound,
  type FantasyTier,
  type LastSeries,
  type ProjectionBasis,
} from "./fantasy-pool";
import type { StatTotals } from "./rv-adjustment";
import { GROUP_STAGE_PREFIX } from "./bracket";
import { leagueWaivers } from "./fantasy-waivers-server";

// The player pool a fantasy league drafts from: every player rostered in the
// real season. The league's own managers are left out, since a manager can't
// roster themselves.

export type PoolTeam = { id: string; name: string };

export type PoolPlayer = {
  id: string;
  discordId: string;
  name: string;
  username: string;
  avatar: string | null;
  tier: FantasyTier;
  team: PoolTeam | null;
  rating: number | null;
  projected: number;
  projectionBasis: ProjectionBasis;
  seasonPoints: number;
  seriesPlayed: number;
  nextOpponent: PoolTeam | null;
  /** The league manager who has this player, once the draft has started. */
  manager: { accountId: string; name: string } | null;
  /** When an unrostered player is on waivers (§9), the run he clears in. Null means a free agent. */
  waiverClearsAt: string | null;
  /** His last group-stage series for his own team, for the trending strip. Null until he's played one. */
  lastSeries: LastSeries | null;
  /**
   * Group-stage match id → the projection for that series as it stood before it
   * was played. Only built for the Matchup tab ({ byMatch: true }).
   */
  matchProjected?: Record<string, number>;
};

export type PoolView = { players: PoolPlayer[]; hiddenForTest: boolean };

type FrozenTier = { player_id: string; tier: FantasyTier; rating: number };

type PlayerRow = PlayerRatingRow & {
  id: string;
  team_id: string | null;
  draft_round?: number | null;
};

type MatchRow = {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  forfeit: boolean | null;
  scheduled_at: string | null;
  stage: string | null;
  round: number | null;
  match_number: number | null;
};

type StatRow = { match_id: string; player_id: string; goals: number; assists: number; saves: number; shots: number; score: number };

const PLAYER_COLS = "id, team_id, peak_2v2, current_2v2, peak_3v3, current_3v3, rv_adjustment";

// draft_round arrives with scripts/draft-round-migration.sql. Before it runs
// the read fails and every drafted player falls back to the rating thirds.
async function fetchPoolPlayers(): Promise<PlayerRow[]> {
  const withRound = await supabaseAdmin.from("players").select(`${PLAYER_COLS}, draft_round`).eq("status", "approved");
  if (!withRound.error) return (withRound.data ?? []) as PlayerRow[];
  const { data } = await supabaseAdmin.from("players").select(PLAYER_COLS).eq("status", "approved");
  return (data ?? []) as PlayerRow[];
}

// Only rostered players are draftable. A sub is filler for whichever team needs
// one, not a fantasy asset, and a sub-willing player who never entered the event
// would otherwise be drafted into it. One swapped onto a team is rostered.
function seasonPlayers(players: PlayerRow[], teamIds: Set<string>) {
  return players.filter((p) => p.team_id && teamIds.has(p.team_id));
}

// A player's tier, read live. Thirds are cut across the whole season, managers
// included: hiding them from one league's list doesn't change where anyone else ranks.
function liveTiers(season: PlayerRow[]): Map<string, FantasyTier> {
  const seasonRatings = season.filter(hasMmrOnFile).map(rulesRatingFromRow);
  return new Map(
    season.map((p) => [
      p.id,
      p.team_id && p.draft_round !== null && p.draft_round !== undefined
        ? tierFromDraftRound(p.draft_round)
        : freeAgentTier(hasMmrOnFile(p) ? rulesRatingFromRow(p) : -Infinity, seasonRatings),
    ]),
  );
}

/** The season's draftable pool as it stands, for freezing when the drafts start. */
export async function currentSeasonTiers(): Promise<{ playerId: string; tier: FantasyTier; rating: number }[]> {
  const [players, { data: teamRows }] = await Promise.all([
    fetchPoolPlayers(),
    supabaseAdmin.from("teams").select("id"),
  ]);
  const season = seasonPlayers(players, new Set(((teamRows ?? []) as { id: string }[]).map((t) => t.id)));
  const tiers = liveTiers(season);
  return season.map((p) => ({
    playerId: p.id,
    tier: tiers.get(p.id)!,
    rating: hasMmrOnFile(p) ? rulesRatingFromRow(p) : 0,
  }));
}

/** The tiers frozen at draft start, or null while the season hasn't drafted (or before the migration). */
export async function frozenTiers(fantasySeasonId: string): Promise<FrozenTier[] | null> {
  const rows = await fetchAllRows<FrozenTier>((from, to) =>
    supabaseAdmin
      .from("fantasy_player_tiers")
      .select("player_id, tier, rating")
      .eq("fantasy_season_id", fantasySeasonId)
      .order("player_id")
      .range(from, to),
  ).catch(() => null);
  if (!rows?.length) return null;
  return rows.map((r) => ({ player_id: r.player_id, tier: Number(r.tier) as FantasyTier, rating: Number(r.rating) }));
}

async function fetchRosterOwners(leagueId: string): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin.from("fantasy_roster_slots").select("player_id, manager_id").eq("league_id", leagueId);
  if (error) return new Map();
  return new Map(((data ?? []) as { player_id: string; manager_id: string }[]).map((r) => [r.player_id, r.manager_id]));
}

export async function getPoolView(leagueId: string, viewerIsStaff: boolean, opts: { byMatch?: boolean } = {}): Promise<PoolView> {
  const testEvent = await isTestEventActive();
  if (testEvent && !viewerIsStaff) return { players: [], hiddenForTest: true };

  const { data: leagueRow } = await supabaseAdmin.from("fantasy_leagues").select("fantasy_season_id").eq("id", leagueId).maybeSingle();
  const [{ data: settings }, players, { data: memberRows }, { data: teamRows }, matches, statsOn, frozen, owners, waivers] = await Promise.all([
    supabaseAdmin.from("league_settings").select("season_active, draft_active, season_format").maybeSingle(),
    fetchPoolPlayers(),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId),
    supabaseAdmin.from("teams").select("id, name, season_rating"),
    fetchAllRows<MatchRow>((from, to) =>
      supabaseAdmin
        .from("matches")
        .select("id, home_team_id, away_team_id, home_score, away_score, status, forfeit, scheduled_at, stage, round, match_number")
        .order("id")
        .range(from, to),
    ),
    isStatsTrackingEnabled(),
    leagueRow ? frozenTiers(leagueRow.fantasy_season_id as string) : Promise.resolve(null),
    fetchRosterOwners(leagueId),
    leagueWaivers(leagueId),
  ]);

  const typedTeams = (teamRows ?? []) as { id: string; name: string; season_rating: number | string | null }[];
  const teams = new Map<string, PoolTeam>(typedTeams.map((t) => [t.id, { id: t.id, name: t.name }]));

  // Team ratings the way the wagers predictor reads them (match-predictions.ts):
  // with stats tracking on, roster RVs replace the drifting season rating.
  const rosterRatings = new Map<string, number[]>();
  for (const p of players) {
    if (!p.team_id) continue;
    const list = rosterRatings.get(p.team_id);
    if (list) list.push(decisionRatingFromRow(p));
    else rosterRatings.set(p.team_id, [decisionRatingFromRow(p)]);
  }
  const teamRating = new Map(
    typedTeams.map((t) => [
      t.id,
      resolveTeamRating(!statsOn && t.season_rating != null ? Number(t.season_rating) : null, rosterRatings.get(t.id) ?? []),
    ]),
  );

  const format = settings?.season_format as { roundBestOf?: RoundBestOfConfig; best_of?: number } | null;
  const fallbackBestOf = (format?.best_of ?? 3) as BestOf;
  const maxRoundByStage: Record<string, number> = {};
  for (const m of matches) {
    if (m.stage) maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round ?? 0);
  }
  const winsNeededFor = (m: MatchRow | undefined) =>
    Math.ceil(
      (m?.stage ? resolveBestOf(m.stage, m.round ?? 1, maxRoundByStage, format?.roundBestOf, fallbackBestOf) : fallbackBestOf) / 2,
    );
  const managerIds = ((memberRows ?? []) as { account_id: string }[]).map((m) => m.account_id);
  const managers = new Set(managerIds);

  // Once the drafts start the pool and its tiers are the frozen ones (§3: fixed
  // for the season), whatever has happened to rosters since.
  const frozenTier = frozen ? new Map(frozen.map((f) => [f.player_id, f.tier])) : null;
  const season = frozenTier ? players.filter((p) => frozenTier.has(p.id)) : seasonPlayers(players, new Set(teams.keys()));
  const tierOf = frozenTier ?? liveTiers(season);
  const pool = season.filter((p) => !managers.has(p.id));
  if (!pool.length) return { players: [], hiddenForTest: false };

  const poolIds = pool.map((p) => p.id);
  const completed = matches.filter((m) => m.status === "completed" && !m.forfeit && m.home_team_id && m.away_team_id);
  const [{ data: accounts }, history, stats] = await Promise.all([
    supabaseAdmin.from("accounts").select("id, discord_id, username, display_name, avatar").in("id", [...poolIds, ...managerIds]),
    fetchAllTimeTotals(),
    completed.length
      ? fetchAllRows<StatRow>((from, to) =>
          supabaseAdmin
            .from("player_game_stats")
            .select("match_id, player_id, goals, assists, saves, shots, score")
            .in("player_id", poolIds)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([] as StatRow[]),
  ]);

  const accountById = new Map(
    ((accounts ?? []) as { id: string; discord_id: string; username: string | null; display_name: string | null; avatar: string | null }[]).map(
      (a) => [a.id, a],
    ),
  );

  const statsByPlayerMatch = new Map<string, StatRow[]>();
  const statsByPlayer = new Map<string, StatRow[]>();
  for (const r of stats) {
    const key = `${r.player_id}:${r.match_id}`;
    const list = statsByPlayerMatch.get(key);
    if (list) list.push(r);
    else statsByPlayerMatch.set(key, [r]);
    const own = statsByPlayer.get(r.player_id);
    if (own) own.push(r);
    else statsByPlayer.set(r.player_id, [r]);
  }

  // A past week is judged against what was projected before it was played, so
  // its history leaves out every game from that week on: the rest of the group
  // stage, and every later stage. During a test event the live games were never
  // in the history (fetchAllTimeTotals), so there is nothing to take out.
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const groupMatches = matches.filter((m) => (m.stage ?? "").startsWith(GROUP_STAGE_PREFIX) && m.round !== null);
  const playedFrom = (statMatchId: string, week: number) => {
    const m = matchById.get(statMatchId);
    if (!m) return false;
    if (!(m.stage ?? "").startsWith(GROUP_STAGE_PREFIX)) return true;
    return (m.round ?? 0) >= week;
  };
  const historyBefore = (playerId: string, totals: StatTotals | null, week: number): StatTotals | null => {
    if (!totals || testEvent) return totals;
    const out = { ...totals };
    for (const r of statsByPlayer.get(playerId) ?? []) {
      if (!playedFrom(r.match_id, week)) continue;
      out.games -= 1;
      out.goals -= r.goals;
      out.assists -= r.assists;
      out.saves -= r.saves;
      out.shots -= r.shots;
      out.score -= r.score;
      if (out.scoreGames !== undefined) out.scoreGames -= 1;
    }
    return out.games > 0 ? out : null;
  };

  const upcoming = matches
    .filter((m) => m.status === "scheduled" && m.home_team_id && m.away_team_id)
    .sort(
      (a, b) =>
        (a.round ?? 0) - (b.round ?? 0) ||
        (a.scheduled_at ?? "￿").localeCompare(b.scheduled_at ?? "￿") ||
        (a.match_number ?? 0) - (b.match_number ?? 0),
    );
  const nextMatchByTeam = new Map<string, { match: MatchRow; opponentId: string }>();
  for (const m of upcoming) {
    if (!nextMatchByTeam.has(m.home_team_id!)) nextMatchByTeam.set(m.home_team_id!, { match: m, opponentId: m.away_team_id! });
    if (!nextMatchByTeam.has(m.away_team_id!)) nextMatchByTeam.set(m.away_team_id!, { match: m, opponentId: m.home_team_id! });
  }

  const out: PoolPlayer[] = pool.map((p) => {
    const a = accountById.get(p.id);
    const ranked = hasMmrOnFile(p);
    const tier = tierOf.get(p.id)!;
    const ownerId = owners.get(p.id);
    const owner = ownerId ? accountById.get(ownerId) : undefined;

    const h = history.get(p.id);
    const totals = h ? { ...h, scoreGames: h.games - (h.scorelessGames ?? 0) } : null;

    // An own-team game is one where the player's current team played, so a
    // series they subbed into for another team counts nothing.
    let seasonPoints = 0;
    let seriesPlayed = 0;
    let last: { match: MatchRow; points: number } | null = null;
    if (p.team_id) {
      for (const m of completed) {
        if (m.home_team_id !== p.team_id && m.away_team_id !== p.team_id) continue;
        const rows = statsByPlayerMatch.get(`${p.id}:${m.id}`);
        if (!rows?.length) continue;
        const home = m.home_team_id === p.team_id;
        const points = seriesPointsFromGames(rows, {
          forfeit: false,
          ownScore: (home ? m.home_score : m.away_score) ?? 0,
          oppScore: (home ? m.away_score : m.home_score) ?? 0,
        });
        seasonPoints += points;
        seriesPlayed += 1;
        // Group stage only: a week's projection is rebuilt from the history
        // before it, which historyBefore can do only for a group round.
        if (!(m.stage ?? "").startsWith(GROUP_STAGE_PREFIX) || m.round === null) continue;
        if (!last || m.round > last.match.round! || (m.round === last.match.round && (m.scheduled_at ?? "") > (last.match.scheduled_at ?? ""))) {
          last = { match: m, points };
        }
      }
    }

    // No next match (a free agent, or a team with nothing scheduled) projects
    // as an even matchup at the season's default series length.
    const next = p.team_id ? nextMatchByTeam.get(p.team_id) : undefined;
    const opponentId = next?.opponentId;
    const matchup = next
      ? {
          ownRating: teamRating.get(p.team_id!) ?? 0,
          oppRating: teamRating.get(next.opponentId) ?? 0,
          winsNeeded: winsNeededFor(next.match),
        }
      : { ownRating: 0, oppRating: 0, winsNeeded: winsNeededFor(undefined) };
    const rating = ranked ? decisionRatingFromRow(p) : null;

    let matchProjected: Record<string, number> | undefined;
    if (opts.byMatch && p.team_id) {
      matchProjected = {};
      for (const m of groupMatches) {
        if (!m.home_team_id || !m.away_team_id) continue;
        if (m.home_team_id !== p.team_id && m.away_team_id !== p.team_id) continue;
        const oppId = m.home_team_id === p.team_id ? m.away_team_id : m.home_team_id;
        matchProjected[m.id] = projectedSeriesPoints(rating, historyBefore(p.id, totals, m.round!), {
          ownRating: teamRating.get(p.team_id) ?? 0,
          oppRating: teamRating.get(oppId) ?? 0,
          winsNeeded: winsNeededFor(m),
        });
      }
    }
    let lastSeries: LastSeries | null = null;
    if (last && p.team_id) {
      const m = last.match;
      const oppId = m.home_team_id === p.team_id ? m.away_team_id! : m.home_team_id!;
      lastSeries = {
        points: last.points,
        projected: projectedSeriesPoints(rating, historyBefore(p.id, totals, m.round!), {
          ownRating: teamRating.get(p.team_id) ?? 0,
          oppRating: teamRating.get(oppId) ?? 0,
          winsNeeded: winsNeededFor(m),
        }),
      };
    }
    return {
      id: p.id,
      discordId: a?.discord_id ?? "",
      name: a?.display_name || a?.username || "Unknown",
      username: a?.username ?? a?.display_name ?? "Unknown",
      avatar: a?.avatar ?? null,
      tier,
      team: p.team_id ? teams.get(p.team_id) ?? null : null,
      rating: shownRatingFromRow(p),
      projected: projectedSeriesPoints(rating, totals, matchup),
      projectionBasis: projectionBasis(totals?.games ?? 0),
      seasonPoints,
      seriesPlayed,
      nextOpponent: opponentId ? teams.get(opponentId) ?? null : null,
      manager: ownerId ? { accountId: ownerId, name: owner?.display_name || owner?.username || "Unknown" } : null,
      waiverClearsAt: ownerId ? null : waivers.get(p.id) ?? null,
      lastSeries,
      matchProjected,
    };
  });

  out.sort((x, y) => y.projected - x.projected);
  return { players: out, hiddenForTest: false };
}
