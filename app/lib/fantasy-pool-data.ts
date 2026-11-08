import "server-only";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./paginate";
import { fetchAllTimeTotals } from "./career-stats";
import { isTestEventActive } from "./test-tournament";
import { decisionRatingFromRow, rulesRatingFromRow, shownRatingFromRow, type PlayerRatingRow } from "./rating";
import { hasMmrOnFile } from "./mmr-on-file";
import {
  freeAgentTier,
  projectedStatPoints,
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
};

export type PoolView = { players: PoolPlayer[]; hiddenForTest: boolean };

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

export async function getPoolView(leagueId: string, viewerIsStaff: boolean): Promise<PoolView> {
  const testEvent = await isTestEventActive();
  if (testEvent && !viewerIsStaff) return { players: [], hiddenForTest: true };

  const [{ data: settings }, players, { data: memberRows }, { data: teamRows }, matches] = await Promise.all([
    supabaseAdmin.from("league_settings").select("season_active, draft_active").maybeSingle(),
    fetchPoolPlayers(),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId),
    supabaseAdmin.from("teams").select("id, name"),
    fetchAllRows<MatchRow>((from, to) =>
      supabaseAdmin
        .from("matches")
        .select("id, home_team_id, away_team_id, home_score, away_score, status, forfeit, scheduled_at, round, match_number")
        .order("id")
        .range(from, to),
    ),
  ]);

  const teams = new Map<string, PoolTeam>(
    ((teamRows ?? []) as { id: string; name: string }[]).map((t) => [
      t.id,
      { id: t.id, name: t.name },
    ]),
  );
  const managers = new Set(((memberRows ?? []) as { account_id: string }[]).map((m) => m.account_id));
  const freeAgentsOpen = !!settings?.season_active && !settings?.draft_active;

  const rostered = players.filter((p) => p.team_id && teams.has(p.team_id));
  const freeAgents = freeAgentsOpen ? players.filter((p) => !p.team_id && p.sub_willing) : [];
  const season = [...rostered, ...freeAgents];
  const pool = season.filter((p) => !managers.has(p.id));
  if (!pool.length) return { players: [], hiddenForTest: false };

  // Thirds are cut across the whole season, managers included: hiding them
  // from this league's list doesn't change where anyone else ranks.
  const seasonRatings = season.filter(hasMmrOnFile).map(rulesRatingFromRow);

  const poolIds = pool.map((p) => p.id);
  const completed = matches.filter((m) => m.status === "completed" && !m.forfeit && m.home_team_id && m.away_team_id);
  const [{ data: accounts }, history, stats] = await Promise.all([
    supabaseAdmin.from("accounts").select("id, discord_id, username, display_name, avatar").in("id", poolIds),
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
  const nextOpponentByTeam = new Map<string, string>();
  for (const m of upcoming) {
    if (!nextOpponentByTeam.has(m.home_team_id!)) nextOpponentByTeam.set(m.home_team_id!, m.away_team_id!);
    if (!nextOpponentByTeam.has(m.away_team_id!)) nextOpponentByTeam.set(m.away_team_id!, m.home_team_id!);
  }

  const out: PoolPlayer[] = pool.map((p) => {
    const a = accountById.get(p.id);
    const ranked = hasMmrOnFile(p);
    const tier =
      p.team_id && p.draft_round !== null && p.draft_round !== undefined
        ? tierFromDraftRound(p.draft_round)
        : freeAgentTier(ranked ? rulesRatingFromRow(p) : -Infinity, seasonRatings);

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

    const opponentId = p.team_id ? nextOpponentByTeam.get(p.team_id) : undefined;
    return {
      id: p.id,
      discordId: a?.discord_id ?? "",
      name: a?.display_name || a?.username || "Unknown",
      username: a?.username ?? a?.display_name ?? "Unknown",
      avatar: a?.avatar ?? null,
      tier,
      team: p.team_id ? teams.get(p.team_id) ?? null : null,
      rating: shownRatingFromRow(p),
      projected: projectedStatPoints(ranked ? decisionRatingFromRow(p) : null, totals),
      projectionBasis: projectionBasis(totals?.games ?? 0),
      seasonPoints,
      seriesPlayed,
      nextOpponent: opponentId ? teams.get(opponentId) ?? null : null,
    };
  });

  out.sort((x, y) => y.projected - x.projected);
  return { players: out, hiddenForTest: false };
}
