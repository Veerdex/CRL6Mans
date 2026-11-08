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
  seriesFantasyPoints,
  tierFromDraftRound,
  type FantasyTier,
  type ProjectionBasis,
} from "./fantasy-pool";

// The player pool a fantasy league drafts from: every player rostered in the
// real season, plus the free agents once the real draft is over. The league's
// own managers are left out, since a manager can't roster themselves.

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
};

export type PoolView = { players: PoolPlayer[]; hiddenForTest: boolean };

type FrozenTier = { player_id: string; tier: FantasyTier; rating: number };

type PlayerRow = PlayerRatingRow & {
  id: string;
  team_id: string | null;
  sub_willing: boolean | null;
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

const PLAYER_COLS = "id, team_id, sub_willing, peak_2v2, current_2v2, peak_3v3, current_3v3, rv_adjustment";

// draft_round arrives with scripts/draft-round-migration.sql. Before it runs
// the read fails and every drafted player falls back to the rating thirds.
async function fetchPoolPlayers(): Promise<PlayerRow[]> {
  const withRound = await supabaseAdmin.from("players").select(`${PLAYER_COLS}, draft_round`).eq("status", "approved");
  if (!withRound.error) return (withRound.data ?? []) as PlayerRow[];
  const { data } = await supabaseAdmin.from("players").select(PLAYER_COLS).eq("status", "approved");
  return (data ?? []) as PlayerRow[];
}

// Free agents join the pool once the real draft is over: either the season is
// running, or the draft has finished and seated players (the window the fantasy
// draft runs in, before Round 1). Before the real draft nobody is rostered, and
// every entrant would otherwise read as a free agent.
function seasonPlayers(players: PlayerRow[], teamIds: Set<string>, settings: { season_active?: boolean; draft_active?: boolean } | null) {
  const rostered = players.filter((p) => p.team_id && teamIds.has(p.team_id));
  const freeAgentsOpen = !settings?.draft_active && (!!settings?.season_active || rostered.length > 0);
  const freeAgents = freeAgentsOpen ? players.filter((p) => !p.team_id && p.sub_willing) : [];
  return [...rostered, ...freeAgents];
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
  const [{ data: settings }, players, { data: teamRows }] = await Promise.all([
    supabaseAdmin.from("league_settings").select("season_active, draft_active").maybeSingle(),
    fetchPoolPlayers(),
    supabaseAdmin.from("teams").select("id"),
  ]);
  const season = seasonPlayers(players, new Set(((teamRows ?? []) as { id: string }[]).map((t) => t.id)), settings);
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

export async function getPoolView(leagueId: string, viewerIsStaff: boolean): Promise<PoolView> {
  const testEvent = await isTestEventActive();
  if (testEvent && !viewerIsStaff) return { players: [], hiddenForTest: true };

  const { data: leagueRow } = await supabaseAdmin.from("fantasy_leagues").select("fantasy_season_id").eq("id", leagueId).maybeSingle();
  const [{ data: settings }, players, { data: memberRows }, { data: teamRows }, matches, statsOn, frozen, owners] = await Promise.all([
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
  const season = frozenTier ? players.filter((p) => frozenTier.has(p.id)) : seasonPlayers(players, new Set(teams.keys()), settings);
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
  for (const r of stats) {
    const key = `${r.player_id}:${r.match_id}`;
    const list = statsByPlayerMatch.get(key);
    if (list) list.push(r);
    else statsByPlayerMatch.set(key, [r]);
  }

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
    if (p.team_id) {
      for (const m of completed) {
        if (m.home_team_id !== p.team_id && m.away_team_id !== p.team_id) continue;
        const rows = statsByPlayerMatch.get(`${p.id}:${m.id}`);
        if (!rows?.length) continue;
        const home = m.home_team_id === p.team_id;
        seasonPoints += seriesFantasyPoints({
          forfeit: false,
          ownScore: (home ? m.home_score : m.away_score) ?? 0,
          oppScore: (home ? m.away_score : m.home_score) ?? 0,
          gamesPlayed: rows.length,
          stats: rows.reduce(
            (s, r) => ({
              score: s.score + r.score,
              goals: s.goals + r.goals,
              assists: s.assists + r.assists,
              saves: s.saves + r.saves,
              shots: s.shots + r.shots,
            }),
            { score: 0, goals: 0, assists: 0, saves: 0, shots: 0 },
          ),
        });
        seriesPlayed += 1;
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
    return {
      id: p.id,
      discordId: a?.discord_id ?? "",
      name: a?.display_name || a?.username || "Unknown",
      username: a?.username ?? a?.display_name ?? "Unknown",
      avatar: a?.avatar ?? null,
      tier,
      team: p.team_id ? teams.get(p.team_id) ?? null : null,
      rating: shownRatingFromRow(p),
      projected: projectedSeriesPoints(ranked ? decisionRatingFromRow(p) : null, totals, matchup),
      projectionBasis: projectionBasis(totals?.games ?? 0),
      seasonPoints,
      seriesPlayed,
      nextOpponent: opponentId ? teams.get(opponentId) ?? null : null,
      manager: ownerId ? { accountId: ownerId, name: owner?.display_name || owner?.username || "Unknown" } : null,
    };
  });

  out.sort((x, y) => y.projected - x.projected);
  return { players: out, hiddenForTest: false };
}
