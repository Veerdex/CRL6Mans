import "server-only";
import { supabaseAdmin } from "./supabase";
import { getLeague } from "./fantasy-leagues";
import type { FantasyTier } from "./fantasy-pool";
import { lockedPlayerIds } from "./fantasy-lineup-server";
import {
  byPreference,
  latestWaiverRun,
  orderAfterRun,
  settleClaims,
  swapInProblem,
  waiverClearsAt,
  waiverOrder,
  type PendingClaim,
} from "./fantasy-waivers";

// Waivers and free agency (docs/fantasy-rl.md §9). The rules are in
// fantasy-waivers.ts; this file reads and writes fantasy_waivers,
// fantasy_waiver_claims and the roster slots they move players through
// (scripts/fantasy-waivers-migration.sql).

type Result = { error?: string };

/** Every player on waivers in the league, with the run he clears in. */
export async function leagueWaivers(leagueId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from("fantasy_waivers").select("player_id, clears_at").eq("league_id", leagueId);
  return new Map(((data ?? []) as { player_id: string; clears_at: string }[]).map((w) => [w.player_id, w.clears_at]));
}

/** Waiver priority, highest first. */
export async function leagueWaiverPriority(leagueId: string): Promise<string[]> {
  const [{ data: league }, { data: members }] = await Promise.all([
    supabaseAdmin.from("fantasy_leagues").select("draft_order, waiver_order").eq("id", leagueId).maybeSingle(),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId).order("joined_at"),
  ]);
  return waiverOrder(
    (league?.waiver_order as string[] | null) ?? null,
    (league?.draft_order as string[] | null) ?? null,
    ((members ?? []) as { account_id: string }[]).map((m) => m.account_id),
  );
}

type ClaimRow = { id: string; manager_id: string; player_id: string; drop_player_id: string; rank: number | null; created_at: string };
const CLAIM_COLUMNS = "id, manager_id, player_id, drop_player_id, rank, created_at";
const toClaim = (c: ClaimRow): PendingClaim => ({
  id: c.id,
  managerId: c.manager_id,
  playerId: c.player_id,
  dropPlayerId: c.drop_player_id,
  rank: c.rank,
  createdAt: c.created_at,
});

/** The manager's pending claims, most wanted first. */
export async function managerPendingClaims(leagueId: string, managerId: string): Promise<PendingClaim[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_waiver_claims")
    .select(CLAIM_COLUMNS)
    .eq("league_id", leagueId)
    .eq("manager_id", managerId)
    .eq("status", "pending");
  return ((data ?? []) as ClaimRow[]).map(toClaim).sort(byPreference);
}

/** Saves the manager's preference across their pending claims, `claimIds` most wanted first. */
export async function rankClaims(leagueId: string, managerId: string, claimIds: string[]): Promise<Result> {
  const pending = await managerPendingClaims(leagueId, managerId);
  const ids = new Set(pending.map((c) => c.id));
  if (claimIds.length !== ids.size || new Set(claimIds).size !== ids.size || claimIds.some((id) => !ids.has(id))) {
    return { error: "Your claims changed in the meantime. Refresh and try again." };
  }
  const results = await Promise.all(
    claimIds.map((id, i) =>
      supabaseAdmin
        .from("fantasy_waiver_claims")
        .update({ rank: i + 1 })
        .eq("id", id)
        .eq("league_id", leagueId)
        .eq("manager_id", managerId)
        .eq("status", "pending"),
    ),
  );
  if (results.some((r) => r.error)) return { error: "Couldn't save that order. Try again." };
  return {};
}

// Everything a page could have drawn wrong is re-derived here: the league is
// past its draft, the caller manages in it, the add is an unrostered pool
// player in the right waiver state, and the swap is like for like.
async function checkMove(
  leagueId: string,
  managerId: string,
  addId: string,
  dropId: string,
  kind: "add" | "claim",
): Promise<{ error: string } | { ok: true }> {
  const league = await getLeague(leagueId);
  if (!league) return { error: "That league doesn't exist." };
  if (league.status !== "active") return { error: "Adds and claims open once the league's draft is finished." };

  const [{ data: tiers }, { data: members }, { data: slots }, { data: waiver }, locked] = await Promise.all([
    supabaseAdmin
      .from("fantasy_player_tiers")
      .select("player_id, tier")
      .eq("fantasy_season_id", league.fantasy_season_id)
      .in("player_id", [addId, dropId]),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId),
    supabaseAdmin.from("fantasy_roster_slots").select("manager_id, player_id").eq("league_id", leagueId).in("player_id", [addId, dropId]),
    supabaseAdmin.from("fantasy_waivers").select("clears_at").eq("league_id", leagueId).eq("player_id", addId).maybeSingle(),
    // A claim settles at the run, which checks the locks then.
    kind === "add" ? lockedPlayerIds([addId, dropId]) : Promise.resolve(new Set<string>()),
  ]);
  const memberIds = new Set(((members ?? []) as { account_id: string }[]).map((m) => m.account_id));
  if (!memberIds.has(managerId)) return { error: "You aren't a manager in this league." };

  const tierOf = new Map(((tiers ?? []) as { player_id: string; tier: number }[]).map((t) => [t.player_id, Number(t.tier) as FantasyTier]));
  const addTier = tierOf.get(addId);
  if (!addTier || memberIds.has(addId)) return { error: "That player isn't in this league's pool." };
  const slotRows = (slots ?? []) as { manager_id: string; player_id: string }[];
  if (slotRows.some((s) => s.player_id === addId)) return { error: "He's already on a roster." };
  if (kind === "add" && waiver) return { error: "He's on waivers, so put in a claim for him instead." };
  if (kind === "claim" && !waiver) return { error: "He isn't on waivers any more. Add him as a free agent instead." };

  const dropTier = tierOf.get(dropId);
  const problem = swapInProblem(
    { tier: addTier, locked: locked.has(addId) },
    dropTier
      ? { tier: dropTier, locked: locked.has(dropId), onRoster: slotRows.some((s) => s.player_id === dropId && s.manager_id === managerId) }
      : null,
  );
  return problem ? { error: problem } : { ok: true };
}

/**
 * Moves `addId` into the slot `dropId` held. Same tier, so the slot still
 * fits; unique(league_id, player_id) on the slots decides a race for the same
 * player. Returns null on success.
 */
async function swapIntoSlot(leagueId: string, managerId: string, addId: string, dropId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_roster_slots")
    .update({ player_id: addId })
    .eq("league_id", leagueId)
    .eq("manager_id", managerId)
    .eq("player_id", dropId)
    .select("slot");
  if (error?.code === "23505") return "Another manager just got him.";
  if (error) return "Couldn't save that move. Try again.";
  if (!data?.length) return "Your roster changed in the meantime. Refresh and try again.";
  return null;
}

async function putOnWaivers(leagueId: string, playerIds: string[], start: Date): Promise<void> {
  if (!playerIds.length) return;
  const clearsAt = waiverClearsAt(start).toISOString();
  const { error } = await supabaseAdmin
    .from("fantasy_waivers")
    .upsert(playerIds.map((p) => ({ league_id: leagueId, player_id: p, clears_at: clearsAt })), { onConflict: "league_id,player_id" });
  if (error) console.error(`[fantasy] waivers for dropped ${playerIds.join(",")} in ${leagueId} failed: ${error.message}`);
}

/** A free agent comes straight onto the roster, first come first served. */
export async function addFreeAgent(leagueId: string, managerId: string, addId: string, dropId: string): Promise<Result> {
  const check = await checkMove(leagueId, managerId, addId, dropId, "add");
  if ("error" in check) return check;
  const failure = await swapIntoSlot(leagueId, managerId, addId, dropId);
  if (failure) return { error: failure };
  await putOnWaivers(leagueId, [dropId], new Date());
  return {};
}

/** Files a claim, or changes who it drops if the manager already has one in for him. */
export async function fileClaim(leagueId: string, managerId: string, playerId: string, dropId: string): Promise<Result> {
  const check = await checkMove(leagueId, managerId, playerId, dropId, "claim");
  if ("error" in check) return check;

  const { data: updated } = await supabaseAdmin
    .from("fantasy_waiver_claims")
    .update({ drop_player_id: dropId })
    .eq("league_id", leagueId)
    .eq("manager_id", managerId)
    .eq("player_id", playerId)
    .eq("status", "pending")
    .select("id");
  if (updated?.length) return {};

  // A new claim goes last in the manager's preference until they reorder.
  const pending = await managerPendingClaims(leagueId, managerId);
  const rank = pending.reduce((max, c, i) => Math.max(max, c.rank ?? i + 1), 0) + 1;
  const { error } = await supabaseAdmin
    .from("fantasy_waiver_claims")
    .insert({ league_id: leagueId, manager_id: managerId, player_id: playerId, drop_player_id: dropId, rank });
  if (error?.code === "23505") return { error: "You already have a claim in for him." };
  if (error) return { error: "Couldn't save that claim. Try again." };
  return {};
}

export async function cancelClaim(leagueId: string, managerId: string, claimId: string): Promise<Result> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_waiver_claims")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("league_id", leagueId)
    .eq("manager_id", managerId)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: "Couldn't cancel that claim. Try again." };
  if (!data?.length) return { error: "That claim has already been settled." };
  return {};
}

type RunLeague = {
  id: string;
  fantasy_season_id: string;
  draft_order: string[] | null;
  waiver_order: string[] | null;
  waivers_ran_at: string | null;
};

/**
 * The daily claims run, called on every cron-pinger tick. Each league runs at
 * most once per 4 AM boundary: the update on waivers_ran_at claims the run, so
 * overlapping ticks can't both settle it. Returns a line per league that ran.
 */
export async function runWaivers(now: Date): Promise<string[]> {
  const boundary = latestWaiverRun(now).toISOString();
  const { data: leagues } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id, fantasy_season_id, draft_order, waiver_order, waivers_ran_at")
    .eq("status", "active")
    .or(`waivers_ran_at.is.null,waivers_ran_at.lt.${boundary}`);

  const fired: string[] = [];
  for (const league of (leagues ?? []) as RunLeague[]) {
    const claim = supabaseAdmin.from("fantasy_leagues").update({ waivers_ran_at: boundary }).eq("id", league.id);
    const { data: claimed } = await (league.waivers_ran_at
      ? claim.eq("waivers_ran_at", league.waivers_ran_at)
      : claim.is("waivers_ran_at", null)
    ).select("id");
    if (!claimed?.length) continue;
    const line = await settleLeague(league, boundary, now).catch((e: unknown) => {
      console.error(`[fantasy] waiver run for ${league.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (line) fired.push(line);
  }
  return fired;
}

async function settleLeague(league: RunLeague, boundary: string, now: Date): Promise<string | null> {
  const { data: dueRows } = await supabaseAdmin
    .from("fantasy_waivers")
    .select("player_id")
    .eq("league_id", league.id)
    .lte("clears_at", boundary)
    .order("clears_at");
  const due = ((dueRows ?? []) as { player_id: string }[]).map((w) => w.player_id);
  if (!due.length) return null;

  const [{ data: claimRows }, { data: slotRows }, { data: members }] = await Promise.all([
    supabaseAdmin
      .from("fantasy_waiver_claims")
      .select(CLAIM_COLUMNS)
      .eq("league_id", league.id)
      .eq("status", "pending")
      .in("player_id", due),
    supabaseAdmin.from("fantasy_roster_slots").select("manager_id, player_id").eq("league_id", league.id),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", league.id).order("joined_at"),
  ]);
  const claims: PendingClaim[] = ((claimRows ?? []) as ClaimRow[]).map(toClaim);

  const rosters = new Map<string, Set<string>>();
  for (const s of (slotRows ?? []) as { manager_id: string; player_id: string }[]) {
    if (!rosters.has(s.manager_id)) rosters.set(s.manager_id, new Set());
    rosters.get(s.manager_id)!.add(s.player_id);
  }
  const involved = [...new Set([...due, ...claims.map((c) => c.dropPlayerId)])];
  const [{ data: tiers }, locked] = await Promise.all([
    supabaseAdmin.from("fantasy_player_tiers").select("player_id, tier").eq("fantasy_season_id", league.fantasy_season_id).in("player_id", involved),
    lockedPlayerIds(involved),
  ]);
  const tierOf = new Map(((tiers ?? []) as { player_id: string; tier: number }[]).map((t) => [t.player_id, Number(t.tier) as FantasyTier]));

  const order = waiverOrder(league.waiver_order, league.draft_order, ((members ?? []) as { account_id: string }[]).map((m) => m.account_id));
  const result = settleClaims({
    due,
    claims,
    order,
    rosters,
    tierOf: (id) => tierOf.get(id),
    locked,
  });

  // Applied in the order they were settled, since a later award can depend on
  // an earlier one having freed its player.
  const outcomes = new Map(result.outcomes.map((o) => [o.id, o]));
  const dropped: string[] = [];
  const winners: string[] = [];
  for (const award of result.awards) {
    const failure = await swapIntoSlot(league.id, award.managerId, award.playerId, award.dropPlayerId);
    if (failure) outcomes.set(award.id, { id: award.id, status: "failed", note: failure });
    else {
      dropped.push(award.dropPlayerId);
      winners.push(award.managerId);
    }
  }
  await putOnWaivers(league.id, dropped, now);

  const resolvedAt = now.toISOString();
  await Promise.all(
    [...outcomes.values()].map((o) =>
      supabaseAdmin
        .from("fantasy_waiver_claims")
        .update({ status: o.status, note: o.note, resolved_at: resolvedAt })
        .eq("id", o.id)
        .eq("status", "pending"),
    ),
  );
  // Pinned to the boundary so a player whose series was reported since, which
  // restarted his waivers, stays on them.
  if (result.cleared.length) {
    await supabaseAdmin.from("fantasy_waivers").delete().eq("league_id", league.id).in("player_id", result.cleared).lte("clears_at", boundary);
  }
  // From the swaps that actually landed, so a claim that lost a race at write
  // time doesn't cost its manager priority.
  if (winners.length) await supabaseAdmin.from("fantasy_leagues").update({ waiver_order: orderAfterRun(order, winners) }).eq("id", league.id);

  return `waivers:${league.id}:${dropped.length}/${result.cleared.length}`;
}
