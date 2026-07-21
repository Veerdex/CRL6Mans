import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getTier } from "@/app/lib/discord-bot";
import { computeMatchPrediction, computeMatchPredictionFromRating, type MatchPrediction } from "./prediction";
import { WagersClient } from "./wagers-client";
import { WagesLeaderboardOnly } from "./leaderboard-view";

const BEST_OF_DEFAULTS: Record<string, number> = {
  standard: 3,
  quarterfinals: 3,
  semifinals: 3,
  finals: 3,
};

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

function rvOf(p: {
  peak_2v2: string | null;
  current_2v2: string | null;
  peak_3v3: string | null;
  current_3v3: string | null;
}): number {
  return (
    (Number(p.peak_2v2 ?? 0) + Number(p.current_2v2 ?? 0)) * 0.3 +
    (Number(p.peak_3v3 ?? 0) + Number(p.current_3v3 ?? 0)) * 0.2
  );
}

export default async function WagersPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const testingMode = cookieStore.get("testing_mode")?.value === "1" && (await isDirector(session.userId));

  const [{ data: ls }, { data: playerRow }, { data: leaderboardData }] = await Promise.all([
    supabaseAdmin
      .from("league_settings")
      .select("active_tournament_id, season_active, season_format")
      .single(),
    supabaseAdmin
      .from("players")
      .select("id, status, crl_coins, username")
      .eq("discord_id", session.userId)
      .single(),
    supabaseAdmin
      .from("players")
      .select("username, display_name, crl_coins")
      .eq("status", "approved")
      .order("crl_coins", { ascending: false }),
  ]);

  if (!playerRow || playerRow.status !== "approved") redirect("/dashboard");

  const activeTournamentId = (ls?.active_tournament_id as string | null) ?? null;
  const seasonActive = ls?.season_active ?? false;
  const hasActiveContent = seasonActive || !!activeTournamentId;

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
          currentUsername={playerRow.username ?? ""}
          balance={playerRow.crl_coins ?? 0}
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
    .select("id, stage, round, match_number, home_team_id, away_team_id, status, scheduled_at")
    .order("stage")
    .order("round")
    .order("match_number");

  const maxRoundByStage: Record<string, number> = {};
  for (const m of allMatches ?? []) {
    if (!m.stage) continue;
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  }

  const format = ls?.season_format as
    | { roundBestOf?: Record<string, number>; best_of?: number }
    | null;
  const roundBestOf = format?.roundBestOf ?? {};

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
  };

  const matches: MatchBO[] = bettable.map((m) => {
    let bestOf = format?.best_of ?? 3;
    if (m.stage?.startsWith("hybrid")) {
      bestOf = 7;
    } else if (m.stage) {
      const maxRound = maxRoundByStage[m.stage] ?? m.round;
      const tier = getTier(m.round, maxRound);
      bestOf = roundBestOf[tier] ?? BEST_OF_DEFAULTS[tier] ?? format?.best_of ?? 3;
    }
    return {
      id: m.id,
      stage: m.stage ?? "",
      round: m.round,
      match_number: m.match_number,
      home_team_id: m.home_team_id!,
      away_team_id: m.away_team_id!,
      status: m.status,
      scheduled_at: m.scheduled_at,
      bestOf,
    };
  });

  // Current stage label
  const stageCounts: Record<string, number> = {};
  for (const m of matches) {
    if (m.stage) stageCounts[m.stage] = (stageCounts[m.stage] ?? 0) + 1;
  }
  const currentStageKey = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const currentStage = currentStageKey ? formatStageName(currentStageKey) : "";

  // Team data
  const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))];

  const [{ data: teamsData }, { data: rosterPlayers }] = await (teamIds.length
    ? Promise.all([
        supabaseAdmin.from("teams").select("id, name, logo_url, season_rating").in("id", teamIds),
        supabaseAdmin
          .from("players")
          .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
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

  // Group player RVs by team (fallback when season_rating not yet set)
  const rvsByTeam: Record<string, number[]> = {};
  for (const p of rosterPlayers ?? []) {
    if (!p.team_id) continue;
    (rvsByTeam[p.team_id] ??= []).push(rvOf(p));
  }

  // Compute predictions — prefer stored season_rating (reflects match history),
  // fall back to raw player RVs for teams that haven't played yet.
  const matchPredictions: Record<string, MatchPrediction> = {};
  for (const m of matches) {
    const hRating = seasonRatings[m.home_team_id];
    const aRating = seasonRatings[m.away_team_id];
    matchPredictions[m.id] =
      hRating != null && aRating != null
        ? computeMatchPredictionFromRating(hRating, aRating, m.bestOf)
        : computeMatchPrediction(
            rvsByTeam[m.home_team_id] ?? [],
            rvsByTeam[m.away_team_id] ?? [],
            m.bestOf,
          );
  }

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
    .select("match_id, bet_type, amount, odds_multiplier, status")
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

  const tickerPlayerIds = [...new Set((tickerRaw ?? []).map((w) => w.player_id))];
  const { data: tickerPlayersData } = tickerPlayerIds.length
    ? await supabaseAdmin
        .from("players")
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
        myWagers={(myWagersData ?? []).map((w) => ({
          match_id: w.match_id,
          bet_type: w.bet_type,
          amount: w.amount,
          odds_multiplier: Number(w.odds_multiplier),
          status: w.status,
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
        coinBalance={playerRow.crl_coins ?? 0}
        currentUsername={playerRow.username ?? ""}
        testingMode={testingMode}
        leaderboard={leaderboard}
      />
    </div>
  );
}
