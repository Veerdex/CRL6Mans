import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { resolveBestOf, type RoundBestOfConfig, type BestOf } from "@/app/dashboard/season/format-constants";
import { calculatePlayerRating } from "@/app/lib/rating";
import { computeMatchPrediction, computeMatchPredictionFromRating, type MatchPrediction } from "./prediction";
import { WagersClient } from "./wagers-client";
import { WagesLeaderboardOnly } from "./leaderboard-view";
import type { OverviewMatch } from "./overview-grid";

function formatStageName(stage: string): string {
  if (stage.startsWith("group_")) return "Groups";
  const map: Record<string, string> = {
    swiss: "Swiss",
    hybrid_ub: "Upper Bracket",
    hybrid8_ub: "Upper Bracket",
    hybrid_lb: "Lower Bracket",
    hybrid8_lb: "Lower Bracket",
    hybrid_sf: "Semifinals",
    hybrid8_sf: "Semifinals",
    hybrid_gf: "Grand Final",
    hybrid8_gf: "Grand Final",
    single_elimination: "Single Elimination",
    de_winners: "Winners Bracket",
    de_losers: "Losers Bracket",
    de_grand_final: "Grand Final",
  };
  return map[stage] ?? stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function playerRatingOf(p: {
  peak_2v2: string | null;
  current_2v2: string | null;
  peak_3v3: string | null;
  current_3v3: string | null;
  peak_1v1: string | null;
  current_1v1: string | null;
}): number {
  return calculatePlayerRating({
    at_1v1: Number(p.peak_1v1 ?? 0),
    season_1v1: Number(p.current_1v1 ?? 0),
    at_2v2: Number(p.peak_2v2 ?? 0),
    season_2v2: Number(p.current_2v2 ?? 0),
    at_3v3: Number(p.peak_3v3 ?? 0),
    season_3v3: Number(p.current_3v3 ?? 0),
  });
}

export default async function WagersPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const isDirector = await isDirectorVerified(session.userId);
  const testingMode = cookieStore.get("testing_mode")?.value === "1" && isDirector;

  // crl_coins/status/username all live on accounts (Tier 1) now, so unregistered
  // and pending guests show up here too — only rejected accounts are excluded,
  // matching the wagers server actions' eligibility gate.
  const [{ data: ls }, { data: accountRow }, { data: leaderboardData }] = await Promise.all([
    supabaseAdmin
      .from("league_settings")
      .select("active_tournament_id, season_active, season_format, betting_mode")
      .single(),
    supabaseAdmin
      .from("accounts")
      .select("id, status, crl_coins, username")
      .eq("discord_id", session.userId)
      .single(),
    supabaseAdmin
      .from("accounts")
      .select("username, display_name, crl_coins")
      .in("status", ["unregistered", "pending", "approved"])
      .order("crl_coins", { ascending: false }),
  ]);

  // Viewing is open to every logged-in player regardless of registration status;
  // placing bets is gated to non-rejected accounts in the wagers server actions.
  const coinBalance = accountRow?.crl_coins ?? 0;
  const currentUsername = accountRow?.username ?? session.username ?? "";

  const activeTournamentId = (ls?.active_tournament_id as string | null) ?? null;
  const seasonActive = ls?.season_active ?? false;
  const hasActiveContent = seasonActive || !!activeTournamentId;
  const globalBettingMode: "fixed" | "pool" = ls?.betting_mode === "pool" ? "pool" : "fixed";

  const leaderboard = (leaderboardData ?? []).map((p) => ({
    username: p.username,
    display_name: p.display_name,
    crl_coins: p.crl_coins ?? 0,
  }));

  // No live event: betting needs matches, but Westside Wages standings persist between
  // events, so show a leaderboard-only view instead of redirecting away.
  if (!hasActiveContent) {
    return (
      <div className="h-full overflow-y-auto">
        <WagesLeaderboardOnly
          entries={leaderboard}
          currentUsername={currentUsername}
          balance={coinBalance}
        />
      </div>
    );
  }

  // Event name
  let eventName = "Season";
  if (activeTournamentId) {
    const { data: t } = await supabaseAdmin
      .from("tournaments")
      .select("name")
      .eq("id", activeTournamentId)
      .single();
    eventName = t?.name ?? "Tournament";
  }

  // Fetch all matches to correctly compute maxRoundByStage for bestOf
  const { data: allMatches } = await supabaseAdmin
    .from("matches")
    .select(
      "id, stage, round, match_number, home_team_id, away_team_id, status, scheduled_at, predicted_home_win_prob, predicted_away_win_prob, betting_mode",
    )
    .order("stage")
    .order("round")
    .order("match_number");

  const maxRoundByStage: Record<string, number> = {};
  for (const m of allMatches ?? []) {
    if (!m.stage) continue;
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  }

  const format = ls?.season_format as
    | { roundBestOf?: RoundBestOfConfig; best_of?: number }
    | null;
  const fallbackBestOf = (format?.best_of ?? 3) as BestOf;

  // Only matches with a confirmed future scheduled time are bettable. Unscheduled
  // matches (scheduled_at null) are hidden — their outcome may already be known or
  // self-reportable, so betting on them must not be possible. Mirrors isBettingClosed
  // in actions.ts.
  const now = Date.now();
  const bettable = (allMatches ?? []).filter(
    (m) =>
      m.status !== "completed" &&
      m.home_team_id &&
      m.away_team_id &&
      m.scheduled_at &&
      new Date(m.scheduled_at).getTime() > now,
  );

  type MatchBO = {
    id: string;
    stage: string;
    round: number;
    match_number: number;
    home_team_id: string;
    away_team_id: string;
    status: string;
    scheduled_at: string | null;
    bestOf: number;
    bettingMode: "fixed" | "pool";
  };

  function bestOfForMatch(m: { stage: string | null; round: number }): number {
    if (!m.stage) return fallbackBestOf;
    return resolveBestOf(m.stage, m.round, maxRoundByStage, format?.roundBestOf, fallbackBestOf);
  }

  const matches: MatchBO[] = bettable.map((m) => ({
    id: m.id,
    stage: m.stage ?? "",
    round: m.round,
    match_number: m.match_number,
    home_team_id: m.home_team_id!,
    away_team_id: m.away_team_id!,
    status: m.status,
    scheduled_at: m.scheduled_at,
    bestOf: bestOfForMatch(m),
    bettingMode: (m.betting_mode as "fixed" | "pool" | null) ?? globalBettingMode,
  }));

  // Pool-mode odds are the live ratio of stake on each side, per independent slot
  // (moneyline, or each O/U line) — unlike fixed-mode's precomputed multiplier,
  // this has to be read fresh from pending wagers on every page load.
  const bettableMatchIds = matches.map((m) => m.id);
  const { data: poolWagersRaw } = bettableMatchIds.length
    ? await supabaseAdmin
        .from("wagers")
        .select("match_id, bet_type, amount")
        .eq("status", "pending")
        .in("match_id", bettableMatchIds)
    : { data: [] as { match_id: string; bet_type: string; amount: number }[] };

  const betTypeTotals: Record<string, Record<string, number>> = {};
  for (const w of poolWagersRaw ?? []) {
    const t = (betTypeTotals[w.match_id] ??= {});
    t[w.bet_type] = (t[w.bet_type] ?? 0) + w.amount;
  }

  // Grid: only matches actually bettable right now (mirrors the `bettable` filter
  // above) plus already-completed ones. A group stage schedules every round's
  // matchup upfront since both teams are known from the start, so filtering on
  // "both teams assigned" alone would surface the entire group schedule at once —
  // scoping to scheduled_at > now (or completed) keeps the grid to what the
  // betting tab actually lets you act on.
  const gridMatchesRaw = (allMatches ?? []).filter(
    (m) =>
      m.home_team_id &&
      m.away_team_id &&
      (m.status === "completed" || (m.scheduled_at && new Date(m.scheduled_at).getTime() > now)),
  );

  // Current stage label
  const stageCounts: Record<string, number> = {};
  for (const m of matches) {
    if (m.stage) stageCounts[m.stage] = (stageCounts[m.stage] ?? 0) + 1;
  }
  const currentStageKey = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const currentStage = currentStageKey ? formatStageName(currentStageKey) : "";

  // Team data
  const teamIds = [
    ...new Set([
      ...matches.flatMap((m) => [m.home_team_id, m.away_team_id]),
      ...gridMatchesRaw.flatMap((m) => [m.home_team_id as string, m.away_team_id as string]),
    ]),
  ];

  const [{ data: teamsData }, { data: rosterPlayers }] = await (teamIds.length
    ? Promise.all([
        supabaseAdmin.from("teams").select("id, name, logo_url, season_rating").in("id", teamIds),
        supabaseAdmin
          .from("players")
          .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1")
          .in("team_id", teamIds)
          .eq("status", "approved"),
      ])
    : Promise.resolve([{ data: [] }, { data: [] }]));

  const teams: Record<string, { id: string; name: string; logo_url: string | null }> = {};
  const seasonRatings: Record<string, number | null> = {};
  for (const t of teamsData ?? []) {
    teams[t.id] = { id: t.id, name: t.name, logo_url: t.logo_url };
    seasonRatings[t.id] = t.season_rating != null ? Number(t.season_rating) : null;
  }

  // Group player ratings by team (fallback when season_rating not yet set)
  const ratingsByTeam: Record<string, number[]> = {};
  for (const p of rosterPlayers ?? []) {
    if (!p.team_id) continue;
    (ratingsByTeam[p.team_id] ??= []).push(playerRatingOf(p));
  }

  // Compute predictions — prefer stored season_rating (reflects match history),
  // fall back to raw player ratings for teams that haven't played yet.
  const matchPredictions: Record<string, MatchPrediction> = {};
  for (const m of matches) {
    const hRating = seasonRatings[m.home_team_id];
    const aRating = seasonRatings[m.away_team_id];
    matchPredictions[m.id] =
      hRating != null && aRating != null
        ? computeMatchPredictionFromRating(hRating, aRating, m.bestOf)
        : computeMatchPrediction(ratingsByTeam[m.home_team_id] ?? [], ratingsByTeam[m.away_team_id] ?? [], m.bestOf);
  }

  // Grid predictions are frozen by the tournament-scheduler cron shortly after a
  // match gets both teams assigned (see freezeUnfrozenMatchPredictions), so this
  // never recomputes from current ratings — only reads the stored snapshot. A
  // match briefly has no snapshot in the window between creation and the next
  // cron tick; it's simply omitted from the grid until then.
  const gridMatches: OverviewMatch[] = gridMatchesRaw
    .filter((m) => m.predicted_home_win_prob != null && m.predicted_away_win_prob != null)
    .map((m) => ({
      id: m.id,
      stage: m.stage ?? "",
      round: m.round,
      match_number: m.match_number,
      status: m.status,
      home_team_id: m.home_team_id as string,
      away_team_id: m.away_team_id as string,
      homeWinProb: Number(m.predicted_home_win_prob),
      awayWinProb: Number(m.predicted_away_win_prob),
    }));

  // Per-team coin totals wagered on the grid, combining straight moneyline wagers
  // with parlay legs (each leg contributes its parent parlay's full stake, not a
  // split share), across all statuses so settled bets still count.
  const gridMatchIds = gridMatches.map((m) => m.id);
  const [{ data: gridWagersRaw }, { data: gridParlayLegsRaw }] = gridMatchIds.length
    ? await Promise.all([
        supabaseAdmin.from("wagers").select("match_id, bet_type, amount").in("match_id", gridMatchIds),
        supabaseAdmin.from("parlay_legs").select("match_id, bet_type, parlay_id").in("match_id", gridMatchIds),
      ])
    : [{ data: [] as { match_id: string; bet_type: string; amount: number }[] }, { data: [] as { match_id: string; bet_type: string; parlay_id: string }[] }];

  const parlayIdsForGrid = [...new Set((gridParlayLegsRaw ?? []).map((l) => l.parlay_id))];
  const { data: gridParlaysRaw } = parlayIdsForGrid.length
    ? await supabaseAdmin.from("parlays").select("id, amount").in("id", parlayIdsForGrid)
    : { data: [] as { id: string; amount: number }[] };
  const parlayAmountById = Object.fromEntries((gridParlaysRaw ?? []).map((p) => [p.id, p.amount]));

  const gridWagerTotals: Record<string, { home: number; away: number }> = {};
  function addGridWager(matchId: string, betType: string, amount: number) {
    const t = (gridWagerTotals[matchId] ??= { home: 0, away: 0 });
    if (betType === "home") t.home += amount;
    else if (betType === "away") t.away += amount;
  }
  for (const w of gridWagersRaw ?? []) addGridWager(w.match_id, w.bet_type, w.amount);
  for (const l of gridParlayLegsRaw ?? []) addGridWager(l.match_id, l.bet_type, parlayAmountById[l.parlay_id] ?? 0);

  // Upcoming matches surface before completed ones; within each group, the
  // most-bet match (highest combined coins across both sides) comes first.
  gridMatches.sort((a, b) => {
    const aCompleted = a.status === "completed" ? 1 : 0;
    const bCompleted = b.status === "completed" ? 1 : 0;
    if (aCompleted !== bCompleted) return aCompleted - bCompleted;
    const aTotal = (gridWagerTotals[a.id]?.home ?? 0) + (gridWagerTotals[a.id]?.away ?? 0);
    const bTotal = (gridWagerTotals[b.id]?.home ?? 0) + (gridWagerTotals[b.id]?.away ?? 0);
    return bTotal - aTotal;
  });

  // Default to the most competitive match (closest to 50/50 — highest risk to bet)
  const defaultMatchId = matches.reduce((picked, m) => {
    const thisDiff = Math.abs(
      (matchPredictions[m.id]?.homeWinProb ?? 0.5) -
        (matchPredictions[m.id]?.awayWinProb ?? 0.5),
    );
    const bestDiff = Math.abs(
      (matchPredictions[picked]?.homeWinProb ?? 0.5) -
        (matchPredictions[picked]?.awayWinProb ?? 0.5),
    );
    return thisDiff < bestDiff ? m.id : picked;
  }, matches[0]?.id ?? "");

  // My wagers
  const { data: myWagersData } = await supabaseAdmin
    .from("wagers")
    .select("match_id, bet_type, amount, odds_multiplier, status, payout_amount")
    .eq("player_id", session.userId);

  // My parlays (+ legs) for the "My Bets" panel
  const { data: myParlaysData } = await supabaseAdmin
    .from("parlays")
    .select("id, amount, combined_multiplier, status")
    .eq("player_id", session.userId);

  const myParlayIds = (myParlaysData ?? []).map((p) => p.id);
  const { data: myParlayLegsData } = myParlayIds.length
    ? await supabaseAdmin
        .from("parlay_legs")
        .select("parlay_id, match_id, bet_type, odds_multiplier, status")
        .in("parlay_id", myParlayIds)
    : { data: [] as { parlay_id: string; match_id: string; bet_type: string; odds_multiplier: number; status: string }[] };

  const legsByParlay: Record<string, { matchId: string; betType: string; oddsMultiplier: number; status: string }[]> = {};
  for (const l of myParlayLegsData ?? []) {
    (legsByParlay[l.parlay_id] ??= []).push({
      matchId: l.match_id,
      betType: l.bet_type,
      oddsMultiplier: Number(l.odds_multiplier),
      status: l.status,
    });
  }

  const myParlays = (myParlaysData ?? []).map((p) => ({
    id: p.id,
    amount: p.amount,
    combinedMultiplier: Number(p.combined_multiplier),
    status: p.status,
    legs: legsByParlay[p.id] ?? [],
  }));

  // Ticker: all pending wagers across all players
  const { data: tickerRaw } = await supabaseAdmin
    .from("wagers")
    .select("id, player_id, match_id, bet_type, amount, placed_at")
    .eq("status", "pending")
    .order("placed_at", { ascending: false })
    .limit(100);

  // wagers.player_id is a raw discord_id (guests can place wagers without a
  // players row), so the ticker's display info is looked up on accounts.
  const tickerPlayerIds = [...new Set((tickerRaw ?? []).map((w) => w.player_id))];
  const { data: tickerPlayersData } = tickerPlayerIds.length
    ? await supabaseAdmin
        .from("accounts")
        .select("discord_id, username, display_name")
        .in("discord_id", tickerPlayerIds)
    : { data: [] };

  const tickerPlayers: Record<string, { username: string; display_name: string | null }> = {};
  for (const p of tickerPlayersData ?? []) {
    tickerPlayers[p.discord_id] = { username: p.username, display_name: p.display_name };
  }

  return (
    <div className="h-full overflow-hidden">
      <WagersClient
        eventName={eventName}
        currentStage={currentStage}
        matches={matches}
        teams={teams}
        matchPredictions={matchPredictions}
        defaultMatchId={defaultMatchId}
        gridMatches={gridMatches}
        gridWagerTotals={gridWagerTotals}
        betTypeTotals={betTypeTotals}
        globalBettingMode={globalBettingMode}
        isDirector={isDirector}
        myWagers={(myWagersData ?? []).map((w) => ({
          match_id: w.match_id,
          bet_type: w.bet_type,
          amount: w.amount,
          odds_multiplier: w.odds_multiplier == null ? null : Number(w.odds_multiplier),
          status: w.status,
          payout_amount: w.payout_amount,
        }))}
        myParlays={myParlays}
        tickerWagers={(tickerRaw ?? []).map((w) => ({
          id: w.id,
          player_id: w.player_id,
          match_id: w.match_id,
          bet_type: w.bet_type,
          amount: w.amount,
          placed_at: w.placed_at,
        }))}
        tickerPlayers={tickerPlayers}
        coinBalance={coinBalance}
        currentUsername={currentUsername}
        testingMode={testingMode}
        leaderboard={leaderboard}
      />
    </div>
  );
}
