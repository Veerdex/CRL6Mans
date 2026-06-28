"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

// Testing-only: zero out every approved player's Westside Wages. Guarded by both
// director status and the testing_mode cookie so it can't run in a live event.
export async function resetAllWestsideWages(): Promise<{ ok?: boolean; error?: string }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not authenticated" };
  if (!(await isDirector(session.userId))) return { error: "Not authorized" };
  if (cookieStore.get("testing_mode")?.value !== "1") return { error: "Testing mode is not enabled." };

  await supabaseAdmin.from("players").update({ crl_coins: 0 }).eq("status", "approved");

  revalidatePath("/dashboard/wagers");
  return { ok: true };
}

export type BetInput = {
  matchId: string;
  betType: string;
  amount: number;
  oddsMultiplier: number;
};

export type ParlayLegInput = {
  matchId: string;
  betType: string;
  oddsMultiplier: number;
};

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

export async function placeBets(bets: BetInput[]): Promise<{ error?: string }> {
  if (!bets.length) return { error: "No bets provided" };

  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not authenticated" };

  for (const b of bets) {
    if (!VALID_BET_TYPES.has(b.betType)) return { error: `Invalid bet type: ${b.betType}` };
    if (!Number.isInteger(b.amount) || b.amount < 10) return { error: "Each bet must be at least 10 Westside Wages" };
    if (b.oddsMultiplier <= 0) return { error: "Invalid odds multiplier" };
  }

  // No duplicate slots in the same batch
  const batchSlots = new Set<string>();
  for (const b of bets) {
    const key = `${b.matchId}:${slotKey(b.betType)}`;
    if (batchSlots.has(key)) return { error: "Duplicate bet slots in batch" };
    batchSlots.add(key);
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, crl_coins, status")
    .eq("discord_id", session.userId)
    .single();

  if (!player || player.status !== "approved") return { error: "Player not found or not approved" };

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
  if ((player.crl_coins ?? 0) < totalCost) return { error: "Insufficient Westside Wages" };

  const matchIds = [...new Set(bets.map((b) => b.matchId))];
  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, status, scheduled_at")
    .in("id", matchIds);

  for (const matchId of matchIds) {
    const match = (matches ?? []).find((m) => m.id === matchId);
    if (!match) return { error: "Match not found" };
    if (match.status === "completed") return { error: "Match is already completed" };
    // TODO: uncomment for production to prevent betting after match start time
    // if (match.scheduled_at && new Date(match.scheduled_at) <= new Date()) {
    //   return { error: "Betting is closed for this match — it has already started" };
    // }
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

  await Promise.all([
    supabaseAdmin.from("wagers").insert(
      bets.map((b) => ({
        player_id: session.userId,
        match_id: b.matchId,
        bet_type: b.betType,
        amount: b.amount,
        odds_multiplier: b.oddsMultiplier,
        status: "pending",
      })),
    ),
    supabaseAdmin
      .from("players")
      .update({ crl_coins: (player.crl_coins ?? 0) - totalCost })
      .eq("id", player.id),
  ]);

  return {};
}

export async function placeParlayBet(
  legs: ParlayLegInput[],
  amount: number,
  combinedMultiplier: number,
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

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, crl_coins, status")
    .eq("discord_id", session.userId)
    .single();

  if (!player || player.status !== "approved") return { error: "Player not found or not approved" };

  // Cap on simultaneous pending parlays
  const { count: pendingParlayCount } = await supabaseAdmin
    .from("parlays")
    .select("*", { count: "exact", head: true })
    .eq("player_id", session.userId)
    .eq("status", "pending");
  if ((pendingParlayCount ?? 0) >= MAX_PENDING_PARLAYS) {
    return { error: `You can have at most ${MAX_PENDING_PARLAYS} pending parlays.` };
  }

  if ((player.crl_coins ?? 0) < amount) return { error: "Insufficient Westside Wages" };

  const matchIds = [...new Set(legs.map((l) => l.matchId))];
  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, status")
    .in("id", matchIds);

  for (const matchId of matchIds) {
    const match = (matches ?? []).find((m) => m.id === matchId);
    if (!match) return { error: "Match not found" };
    if (match.status === "completed") return { error: "Cannot include a completed match in a parlay" };
  }

  const { data: parlay, error: parlayErr } = await supabaseAdmin
    .from("parlays")
    .insert({ player_id: session.userId, amount, combined_multiplier: combinedMultiplier, status: "pending" })
    .select("id")
    .single();

  if (parlayErr || !parlay) return { error: "Failed to place parlay" };

  await Promise.all([
    supabaseAdmin.from("parlay_legs").insert(
      legs.map((l) => ({
        parlay_id: parlay.id,
        match_id: l.matchId,
        bet_type: l.betType,
        odds_multiplier: l.oddsMultiplier,
        status: "pending",
      })),
    ),
    supabaseAdmin
      .from("players")
      .update({ crl_coins: (player.crl_coins ?? 0) - amount })
      .eq("id", player.id),
  ]);

  return {};
}
