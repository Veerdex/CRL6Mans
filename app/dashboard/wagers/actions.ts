"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getBestOfForMatch } from "@/app/lib/discord-bot";
import {
  computeMatchPredictionFromRating,
  computeMatchPrediction,
  payoutMultiplier,
} from "./prediction";

// Testing-only: zero out every eligible account's Westside Wages (everyone but
// rejected — unregistered/pending/approved can all wager). Guarded by both
// director status and the testing_mode cookie so it can't run in a live event.
export async function resetAllWestsideWages(): Promise<{ ok?: boolean; error?: string }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not authenticated" };
  if (!(await isDirectorVerified(session.userId))) return { error: "Not authorized" };
  if (cookieStore.get("testing_mode")?.value !== "1") return { error: "Testing mode is not enabled." };

  await supabaseAdmin.from("accounts").update({ crl_coins: 0 }).in("status", ["unregistered", "pending", "approved"]);

  revalidatePath("/dashboard/wagers");
  return { ok: true };
}

export type BetInput = {
  matchId: string;
  betType: string;
  amount: number;
  oddsMultiplier: number; // client display value only; server recomputes before storing
};

export type ParlayLegInput = {
  matchId: string;
  betType: string;
  oddsMultiplier: number; // client display value only; server recomputes before storing
};

type MatchOdds = {
  home: number;
  away: number;
  ou: { line: number; over: number; under: number }[];
};

async function computeServerOdds(
  homeTeamId: string,
  awayTeamId: string,
  bestOf: number,
): Promise<MatchOdds | null> {
  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("id, season_rating")
    .in("id", [homeTeamId, awayTeamId]);

  const home = teams?.find((t) => t.id === homeTeamId);
  const away = teams?.find((t) => t.id === awayTeamId);
  if (!home || !away) return null;

  let prediction;
  if (home.season_rating != null && away.season_rating != null) {
    prediction = computeMatchPredictionFromRating(
      Number(home.season_rating),
      Number(away.season_rating),
      bestOf,
    );
  } else {
    const { data: players } = await supabaseAdmin
      .from("players")
      .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .in("team_id", [homeTeamId, awayTeamId])
      .eq("status", "approved");

    const rvs = (teamId: string) =>
      (players ?? [])
        .filter((p) => p.team_id === teamId)
        .map(
          (p) =>
            (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 +
            (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2,
        );

    prediction = computeMatchPrediction(rvs(homeTeamId), rvs(awayTeamId), bestOf);
  }

  return {
    home: payoutMultiplier(prediction.homeWinProb),
    away: payoutMultiplier(prediction.awayWinProb),
    ou: prediction.ouLines.map((l) => ({
      line: l.line,
      over: payoutMultiplier(l.overProb),
      under: payoutMultiplier(l.underProb),
    })),
  };
}

function getMultiplierForBetType(odds: MatchOdds, betType: string): number | null {
  if (betType === "home") return odds.home;
  if (betType === "away") return odds.away;
  const m = betType.match(/^(over|under)_([\d.]+)$/);
  if (!m) return null;
  const entry = odds.ou.find((l) => l.line === Number(m[2]));
  if (!entry) return null;
  return m[1] === "over" ? entry.over : entry.under;
}

const MAX_PENDING_BETS = 10;
const MAX_PENDING_PARLAYS = 3;
const MAX_PARLAY_LEGS = 5;

const VALID_BET_TYPES = new Set([
  "home", "away",
  "over_2.5", "under_2.5",
  "over_3.5", "under_3.5",
  "over_4.5", "under_4.5",
  "over_5.5", "under_5.5",
  "over_6.5", "under_6.5",
]);

function slotKey(betType: string): string {
  if (betType === "home" || betType === "away") return "moneyline";
  const m = betType.match(/^(?:over|under)_([\d.]+)$/);
  return m ? `ou_${m[1]}` : betType;
}

type MatchBettingState = {
  status: string | null;
  scheduled_at: string | null;
  home_score: number | null;
  pending_home_score: number | null;
  score_submitted_at: string | null;
  home_checked_in: boolean | null;
  away_checked_in: boolean | null;
};

// Betting is only open for matches with a confirmed future scheduled time. Results are
// player-reported and a single team can auto-finalize them, so an unscheduled match
// (scheduled_at null — the default for most bracket matches) must NOT be bettable: its
// outcome may already be known or self-reportable. Past start, a submitted/finalized
// result, or both teams checked in also close betting as defense in depth.
function isBettingClosed(match: MatchBettingState): string | null {
  if (match.status === "completed" || match.home_score !== null) {
    return "Match is already completed";
  }
  if (match.pending_home_score !== null || match.score_submitted_at !== null) {
    return "Betting is closed — a result has already been submitted for this match.";
  }
  if (match.home_checked_in && match.away_checked_in) {
    return "Betting is closed — this match has already started.";
  }
  if (!match.scheduled_at) {
    return "Betting isn't open for this match yet — it hasn't been scheduled.";
  }
  if (new Date(match.scheduled_at) <= new Date()) {
    return "Betting is closed for this match — it has already started.";
  }
  return null;
}

export async function placeBets(bets: BetInput[]): Promise<{ error?: string }> {
  if (!bets.length) return { error: "No bets provided" };

  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not authenticated" };

  for (const b of bets) {
    if (!VALID_BET_TYPES.has(b.betType)) return { error: `Invalid bet type: ${b.betType}` };
    if (!Number.isInteger(b.amount) || b.amount < 10) return { error: "Each bet must be at least 10 Westside Wages" };
  }

  // No duplicate slots in the same batch
  const batchSlots = new Set<string>();
  for (const b of bets) {
    const key = `${b.matchId}:${slotKey(b.betType)}`;
    if (batchSlots.has(key)) return { error: "Duplicate bet slots in batch" };
    batchSlots.add(key);
  }

  // Wagering eligibility/balance live on accounts (Tier 1) so unregistered and
  // pending guests can bet too — only rejected accounts are excluded. team_id
  // (Tier 3, only set for rostered players) is looked up separately since a
  // guest has no players row at all.
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("id, crl_coins, status")
    .eq("discord_id", session.userId)
    .single();

  if (!account || account.status === "rejected") {
    return { error: "Player not found or not eligible to bet" };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("discord_id", session.userId)
    .single();
  const teamId = player?.team_id ?? null;

  // Cap on simultaneous pending bets
  const { count: pendingBetCount } = await supabaseAdmin
    .from("wagers")
    .select("*", { count: "exact", head: true })
    .eq("player_id", session.userId)
    .eq("status", "pending");
  if ((pendingBetCount ?? 0) + bets.length > MAX_PENDING_BETS) {
    return { error: `You can have at most ${MAX_PENDING_BETS} pending bets (you have ${pendingBetCount ?? 0}).` };
  }

  const totalCost = bets.reduce((s, b) => s + b.amount, 0);
  if ((account.crl_coins ?? 0) < totalCost) return { error: "Insufficient Westside Wages" };

  const matchIds = [...new Set(bets.map((b) => b.matchId))];
  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, status, scheduled_at, home_team_id, away_team_id, home_score, pending_home_score, score_submitted_at, home_checked_in, away_checked_in")
    .in("id", matchIds);

  for (const matchId of matchIds) {
    const match = (matches ?? []).find((m) => m.id === matchId);
    if (!match) return { error: "Match not found" };
    const closed = isBettingClosed(match);
    if (closed) return { error: closed };
    // Players cannot bet on a match their own team is in — they control its result reporting.
    if (teamId && (match.home_team_id === teamId || match.away_team_id === teamId)) {
      return { error: "You cannot bet on a match your own team is playing in." };
    }
  }

  // Compute server-side odds for each match so the client cannot supply its own multiplier.
  // best_of isn't a stored column — it's derived from stage/round/format, same as everywhere else.
  const oddsMap = new Map<string, MatchOdds>();
  for (const match of matches ?? []) {
    if (match.home_team_id && match.away_team_id) {
      const bestOf = await getBestOfForMatch(match.id);
      const odds = await computeServerOdds(match.home_team_id, match.away_team_id, bestOf);
      if (odds) oddsMap.set(match.id, odds);
    }
  }

  // No duplicate slots against already-placed bets
  const { data: existing } = await supabaseAdmin
    .from("wagers")
    .select("match_id, bet_type")
    .eq("player_id", session.userId)
    .in("match_id", matchIds);

  for (const b of bets) {
    const conflict = (existing ?? []).find(
      (w) => w.match_id === b.matchId && slotKey(w.bet_type) === slotKey(b.betType),
    );
    if (conflict) return { error: "You already have a bet on this slot" };
  }

  const resolvedBets = bets.map((b) => {
    const odds = oddsMap.get(b.matchId);
    const serverMultiplier = odds ? getMultiplierForBetType(odds, b.betType) : null;
    return { ...b, serverMultiplier };
  });

  for (const b of resolvedBets) {
    if (!b.serverMultiplier) return { error: "Could not compute odds for one or more bets" };
  }

  await Promise.all([
    supabaseAdmin.from("wagers").insert(
      resolvedBets.map((b) => ({
        player_id: session.userId,
        match_id: b.matchId,
        bet_type: b.betType,
        amount: b.amount,
        odds_multiplier: b.serverMultiplier,
        status: "pending",
      })),
    ),
    supabaseAdmin
      .from("accounts")
      .update({ crl_coins: (account.crl_coins ?? 0) - totalCost })
      .eq("id", account.id),
  ]);

  return {};
}

export async function placeParlayBet(
  legs: ParlayLegInput[],
  amount: number,
  _combinedMultiplier: number, // client display value only; server recomputes before storing
): Promise<{ error?: string }> {
  if (legs.length < 2) return { error: "A parlay requires at least 2 legs" };
  if (legs.length > MAX_PARLAY_LEGS) return { error: `A parlay can have at most ${MAX_PARLAY_LEGS} legs` };

  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not authenticated" };

  for (const l of legs) {
    if (!VALID_BET_TYPES.has(l.betType)) return { error: `Invalid bet type: ${l.betType}` };
  }
  if (!Number.isInteger(amount) || amount < 10) return { error: "Minimum parlay bet is 10 Westside Wages" };

  const parlayMatchIds = new Set<string>();
  const parlaySlots = new Set<string>();
  for (const l of legs) {
    if (parlayMatchIds.has(l.matchId)) return { error: "Parlay legs must be from different matches" };
    parlayMatchIds.add(l.matchId);
    const key = `${l.matchId}:${slotKey(l.betType)}`;
    if (parlaySlots.has(key)) return { error: "Duplicate bet slots in parlay" };
    parlaySlots.add(key);
  }

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("id, crl_coins, status")
    .eq("discord_id", session.userId)
    .single();

  if (!account || account.status === "rejected") {
    return { error: "Player not found or not eligible to bet" };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("discord_id", session.userId)
    .single();
  const teamId = player?.team_id ?? null;

  // Cap on simultaneous pending parlays
  const { count: pendingParlayCount } = await supabaseAdmin
    .from("parlays")
    .select("*", { count: "exact", head: true })
    .eq("player_id", session.userId)
    .eq("status", "pending");
  if ((pendingParlayCount ?? 0) >= MAX_PENDING_PARLAYS) {
    return { error: `You can have at most ${MAX_PENDING_PARLAYS} pending parlays.` };
  }

  if ((account.crl_coins ?? 0) < amount) return { error: "Insufficient Westside Wages" };

  const matchIds = [...new Set(legs.map((l) => l.matchId))];
  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, status, scheduled_at, home_team_id, away_team_id, home_score, pending_home_score, score_submitted_at, home_checked_in, away_checked_in")
    .in("id", matchIds);

  for (const matchId of matchIds) {
    const match = (matches ?? []).find((m) => m.id === matchId);
    if (!match) return { error: "Match not found" };
    const closed = isBettingClosed(match);
    if (closed) return { error: closed };
    // Players cannot bet on a match their own team is in — they control its result reporting.
    if (teamId && (match.home_team_id === teamId || match.away_team_id === teamId)) {
      return { error: "You cannot include a match your own team is playing in." };
    }
  }

  // Compute server-side odds for each match so the client cannot supply its own multipliers.
  // best_of isn't a stored column — it's derived from stage/round/format, same as everywhere else.
  const oddsMap = new Map<string, MatchOdds>();
  for (const match of matches ?? []) {
    if (match.home_team_id && match.away_team_id) {
      const bestOf = await getBestOfForMatch(match.id);
      const odds = await computeServerOdds(match.home_team_id, match.away_team_id, bestOf);
      if (odds) oddsMap.set(match.id, odds);
    }
  }

  const resolvedLegs = legs.map((l) => {
    const odds = oddsMap.get(l.matchId);
    const legMultiplier = odds ? getMultiplierForBetType(odds, l.betType) : null;
    return { ...l, legMultiplier };
  });

  let serverCombinedMultiplier = 1;
  for (const l of resolvedLegs) {
    if (!l.legMultiplier) return { error: "Could not compute odds for one or more legs" };
    serverCombinedMultiplier *= l.legMultiplier;
  }
  serverCombinedMultiplier = Math.round(serverCombinedMultiplier * 100) / 100;

  const { data: parlay, error: parlayErr } = await supabaseAdmin
    .from("parlays")
    .insert({ player_id: session.userId, amount, combined_multiplier: serverCombinedMultiplier, status: "pending" })
    .select("id")
    .single();

  if (parlayErr || !parlay) return { error: "Failed to place parlay" };

  await Promise.all([
    supabaseAdmin.from("parlay_legs").insert(
      resolvedLegs.map((l) => ({
        parlay_id: parlay.id,
        match_id: l.matchId,
        bet_type: l.betType,
        odds_multiplier: l.legMultiplier,
        status: "pending",
      })),
    ),
    supabaseAdmin
      .from("accounts")
      .update({ crl_coins: (account.crl_coins ?? 0) - amount })
      .eq("id", account.id),
  ]);

  return {};
}
