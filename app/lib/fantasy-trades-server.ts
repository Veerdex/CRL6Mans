import "server-only";
import { supabaseAdmin } from "./supabase";
import { getLeague, type LeagueRow } from "./fantasy-leagues";
import { accountNames, notifyManagers } from "./fantasy-notify";
import { lockedPlayerIds, managerLineup } from "./fantasy-lineup-server";
import {
  REVIEW_MS,
  reviewOutcome,
  tallyVotes,
  tradeMoves,
  tradeShapeProblem,
  type TradeStatus,
  type TradeView,
  type TradeVote,
} from "./fantasy-trades";
import { eliminatedInLeague } from "./fantasy-matchup-server";
import { FROZEN_NOTE } from "./fantasy-schedule";
import { TRADES_DISABLED_NOTE } from "./fantasy-rules";

// Trades (docs/fantasy-rl.md §10). The rules are in fantasy-trades.ts; the
// move itself is fantasy_accept_trade (scripts/fantasy-trades-migration.sql).
// An accepted trade goes to the rest of the league for review before it moves
// anyone (scripts/fantasy-trade-review-migration.sql).

type Result = { error?: string };

/** A trade that hasn't settled: offered, or accepted and in league review. */
const OPEN: TradeStatus[] = ["pending", "review"];

/** The director's switch for every league. A read error (pre-migration) is off. */
export async function fantasyTradesEnabled(): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("league_settings").select("fantasy_trades_enabled").single();
  return !error && data?.fantasy_trades_enabled === true;
}

/**
 * Turning trades off cancels every open one, so turning them back on later
 * doesn't revive offers made against rosters that have since changed.
 */
export async function setFantasyTradesEnabledCore(on: boolean): Promise<Result> {
  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ fantasy_trades_enabled: on, updated_at: new Date().toISOString() })
    .not("id", "is", null);
  if (error) return { error: "Couldn't save that. Has scripts/fantasy-trades-toggle-migration.sql been run?" };
  if (!on) {
    await supabaseAdmin
      .from("fantasy_trades")
      .update({ status: "cancelled", note: TRADES_DISABLED_NOTE, resolved_at: new Date().toISOString() })
      .in("status", OPEN);
  }
  return {};
}

const RECENT_MS = 7 * 24 * 3600_000;

const TRADE_COLUMNS =
  "id, proposer_id, receiver_id, status, note, created_at, resolved_at, review_ends_at, proposer_dismissed, receiver_dismissed, fantasy_trade_items(player_id, from_manager_id)";

type TradeRow = {
  id: string;
  proposer_id: string;
  receiver_id: string;
  status: TradeStatus;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  review_ends_at: string | null;
  proposer_dismissed: boolean;
  receiver_dismissed: boolean;
  fantasy_trade_items: { player_id: string; from_manager_id: string }[];
};

async function activeManagerIds(leagueId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id")
    .eq("league_id", leagueId)
    .is("orphaned_at", null);
  return ((data ?? []) as { account_id: string }[]).map((m) => m.account_id);
}

/** Who reviews a trade: every manager still running a team, other than the two in it. */
const votersOf = (managers: string[], t: { proposer_id: string; receiver_id: string }) =>
  new Set(managers.filter((id) => id !== t.proposer_id && id !== t.receiver_id));

async function votesFor(tradeIds: string[]): Promise<Map<string, { accountId: string; vote: TradeVote }[]>> {
  const byTrade = new Map<string, { accountId: string; vote: TradeVote }[]>();
  if (!tradeIds.length) return byTrade;
  const { data } = await supabaseAdmin.from("fantasy_trade_votes").select("trade_id, account_id, vote").in("trade_id", tradeIds);
  for (const v of (data ?? []) as { trade_id: string; account_id: string; vote: TradeVote }[]) {
    const list = byTrade.get(v.trade_id) ?? [];
    list.push({ accountId: v.account_id, vote: v.vote });
    byTrade.set(v.trade_id, list);
  }
  return byTrade;
}

async function toViews(leagueId: string, rows: TradeRow[], viewerId: string): Promise<TradeView[]> {
  const inReview = rows.filter((t) => t.status === "review");
  const [managers, votes] = inReview.length
    ? await Promise.all([activeManagerIds(leagueId), votesFor(inReview.map((t) => t.id))])
    : [[], new Map<string, { accountId: string; vote: TradeVote }[]>()];
  return rows.map((t) => {
    const cast = votes.get(t.id) ?? [];
    return {
      id: t.id,
      proposerId: t.proposer_id,
      receiverId: t.receiver_id,
      status: t.status,
      note: t.note,
      createdAt: t.created_at,
      resolvedAt: t.resolved_at,
      items: t.fantasy_trade_items.map((i) => ({ playerId: i.player_id, fromManagerId: i.from_manager_id })),
      review:
        t.status === "review" && t.review_ends_at
          ? {
              ...tallyVotes(cast, votersOf(managers, t)),
              endsAt: t.review_ends_at,
              myVote: cast.find((v) => v.accountId === viewerId)?.vote ?? null,
            }
          : null,
    };
  });
}

/** The manager's open trades, then the last week's settled ones, newest first. */
export async function managerTrades(leagueId: string, managerId: string): Promise<TradeView[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_trades")
    .select(TRADE_COLUMNS)
    .eq("league_id", leagueId)
    .or(`proposer_id.eq.${managerId},receiver_id.eq.${managerId}`)
    .order("created_at", { ascending: false })
    .limit(40);
  const visible = ((data ?? []) as TradeRow[]).filter((t) =>
    t.proposer_id === managerId ? !t.proposer_dismissed : !t.receiver_dismissed,
  );
  const trades = await toViews(leagueId, visible, managerId);
  const since = Date.now() - RECENT_MS;
  return [
    ...trades.filter((t) => OPEN.includes(t.status)),
    ...trades.filter((t) => !OPEN.includes(t.status) && t.resolvedAt && new Date(t.resolvedAt).getTime() >= since),
  ];
}

/** Trades between two other managers that this one gets a vote on. */
export async function leagueReviews(leagueId: string, managerId: string): Promise<TradeView[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_trades")
    .select(TRADE_COLUMNS)
    .eq("league_id", leagueId)
    .eq("status", "review")
    .neq("proposer_id", managerId)
    .neq("receiver_id", managerId)
    .order("review_ends_at");
  return toViews(leagueId, (data ?? []) as TradeRow[], managerId);
}

async function activeLeagueWithMembers(leagueId: string, managerIds: string[]): Promise<LeagueRow | { error: string }> {
  const league = await getLeague(leagueId);
  if (!league) return { error: "That league doesn't exist." };
  if (league.status !== "active") return { error: "Trades open once the league's draft is finished." };
  const { data } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id")
    .eq("league_id", leagueId)
    .in("account_id", managerIds)
    .is("orphaned_at", null);
  if ((data ?? []).length !== new Set(managerIds).size) return { error: "Both managers have to be in this league." };
  return league;
}

const FROZEN_TRADE_NOTE = "One side's season is over, and its roster is frozen.";

/** §7/§10: an open trade is called off once either side is eliminated. */
export async function cancelFrozenTrades(leagueId: string, eliminated: Set<string>): Promise<void> {
  if (!eliminated.size) return;
  const ids = [...eliminated].join(",");
  const { data, error } = await supabaseAdmin
    .from("fantasy_trades")
    .update({ status: "cancelled", note: FROZEN_TRADE_NOTE, resolved_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .in("status", OPEN)
    .or(`proposer_id.in.(${ids}),receiver_id.in.(${ids})`)
    .select("proposer_id, receiver_id");
  if (error) return console.error(`[fantasy] cancelling frozen trades in ${leagueId} failed: ${error.message}`);
  // Only the rows this call moved off open come back, so a page load that
  // finds nothing left to cancel notifies nobody.
  const rows = (data ?? []) as { proposer_id: string; receiver_id: string }[];
  if (rows.length) {
    notify(
      rows.flatMap((r) => [r.proposer_id, r.receiver_id]),
      "Fantasy trade called off",
      `A trade of yours was cancelled. ${FROZEN_TRADE_NOTE}`,
      leagueId,
    );
  }
}

async function frozenProblem(leagueId: string, viewerId: string, otherId: string): Promise<string | null> {
  const eliminated = await eliminatedInLeague(leagueId);
  if (eliminated.has(viewerId)) return FROZEN_NOTE;
  if (eliminated.has(otherId)) return "Their season is over, so their roster is frozen.";
  return null;
}

function notify(accountIds: string[], title: string, body: string, leagueId: string): void {
  notifyManagers(accountIds, "fantasy_trades", { title, body, url: `/dashboard/fantasy/${leagueId}/players` });
}

const names = accountNames;

export async function proposeTrade(
  leagueId: string,
  proposerId: string,
  receiverId: string,
  giveIds: string[],
  getIds: string[],
): Promise<Result> {
  if (!(await fantasyTradesEnabled())) return { error: TRADES_DISABLED_NOTE };
  if (proposerId === receiverId) return { error: "You can't trade with yourself." };
  const give = [...new Set(giveIds)];
  const get = [...new Set(getIds)];
  const league = await activeLeagueWithMembers(leagueId, [proposerId, receiverId]);
  if ("error" in league) return league;
  const frozen = await frozenProblem(leagueId, proposerId, receiverId);
  if (frozen) return { error: frozen };

  const [mine, theirs] = await Promise.all([
    managerLineup(leagueId, league.fantasy_season_id, proposerId),
    managerLineup(leagueId, league.fantasy_season_id, receiverId),
  ]);
  const giving = mine.filter((e) => give.includes(e.playerId));
  const getting = theirs.filter((e) => get.includes(e.playerId));
  if (giving.length !== give.length || getting.length !== get.length) {
    return { error: "Those rosters changed in the meantime. Refresh and try again." };
  }
  const shape = tradeShapeProblem(giving, getting);
  if (shape) return { error: shape };

  const { data: trade, error } = await supabaseAdmin
    .from("fantasy_trades")
    .insert({ league_id: leagueId, proposer_id: proposerId, receiver_id: receiverId })
    .select("id")
    .single();
  if (error || !trade) return { error: "Couldn't send that trade. Try again." };
  const { error: itemsError } = await supabaseAdmin.from("fantasy_trade_items").insert([
    ...give.map((p) => ({ trade_id: trade.id, player_id: p, from_manager_id: proposerId })),
    ...get.map((p) => ({ trade_id: trade.id, player_id: p, from_manager_id: receiverId })),
  ]);
  if (itemsError) {
    await supabaseAdmin.from("fantasy_trades").delete().eq("id", trade.id);
    return { error: "Couldn't send that trade. Try again." };
  }

  const n = await names([proposerId, ...give, ...get]);
  const list = (ids: string[]) => ids.map((id) => n.get(id) ?? "Unknown").join(", ");
  notify(
    [receiverId],
    "Fantasy trade offer",
    `${n.get(proposerId)} offered ${list(give)} for ${list(get)} in ${league.name}.`,
    leagueId,
  );
  return {};
}

/**
 * Moves a trade from one of `from` to `status`. Only the call that actually
 * moved it gets the parties back, so racing callers notify once.
 */
async function settle(
  leagueId: string,
  tradeId: string,
  from: TradeStatus[],
  status: TradeStatus,
  note: string | null,
  where: { receiver?: string; either?: string } = {},
) {
  let q = supabaseAdmin
    .from("fantasy_trades")
    .update({ status, note, resolved_at: new Date().toISOString() })
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .in("status", from);
  if (where.receiver) q = q.eq("receiver_id", where.receiver);
  if (where.either) q = q.or(`proposer_id.eq.${where.either},receiver_id.eq.${where.either}`);
  const { data, error } = await q.select("proposer_id, receiver_id");
  if (error) return { error: "Couldn't update that trade. Try again." };
  if (!data?.length) return { error: "That trade isn't open any more." };
  const row = data[0] as { proposer_id: string; receiver_id: string };
  return { proposerId: row.proposer_id, receiverId: row.receiver_id };
}

/** Either manager can cancel a trade until it goes through, review included. */
export async function cancelTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  const res = await settle(leagueId, tradeId, OPEN, "cancelled", null, { either: managerId });
  if ("error" in res) return res;
  const other = res.proposerId === managerId ? res.receiverId : res.proposerId;
  const [league, n] = await Promise.all([getLeague(leagueId), names([managerId])]);
  notify(
    [other],
    res.proposerId === managerId ? "Fantasy trade withdrawn" : "Fantasy trade cancelled",
    `${n.get(managerId)} ${res.proposerId === managerId ? "withdrew their offer" : "cancelled your trade"} in ${league?.name ?? "your league"}.`,
    leagueId,
  );
  return {};
}

/** Hides a settled trade from this manager's list; the other side still sees it. */
export async function dismissTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  const { data } = await supabaseAdmin
    .from("fantasy_trades")
    .select("proposer_id, receiver_id")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .not("status", "in", `(${OPEN.join(",")})`)
    .maybeSingle();
  if (!data || (data.proposer_id !== managerId && data.receiver_id !== managerId)) {
    return { error: "That trade can't be dismissed." };
  }
  const column = data.proposer_id === managerId ? "proposer_dismissed" : "receiver_dismissed";
  const { error } = await supabaseAdmin.from("fantasy_trades").update({ [column]: true }).eq("id", tradeId);
  return error ? { error: "Couldn't dismiss that trade. Try again." } : {};
}

export async function rejectTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  const res = await settle(leagueId, tradeId, ["pending"], "rejected", null, { receiver: managerId });
  if ("error" in res) return res;
  const league = await getLeague(leagueId);
  const n = await names([managerId]);
  notify([res.proposerId], "Fantasy trade rejected", `${n.get(managerId)} rejected your trade in ${league?.name ?? "your league"}.`, leagueId);
  return {};
}

type Items = { player_id: string; from_manager_id: string }[];

/** Where every player would land if the trade went through now, or why it can't. */
async function movesFor(league: LeagueRow, proposerId: string, receiverId: string, items: Items) {
  const [theirs, mine] = await Promise.all([
    managerLineup(league.id, league.fantasy_season_id, proposerId),
    managerLineup(league.id, league.fantasy_season_id, receiverId),
  ]);
  return tradeMoves(
    { managerId: proposerId, lineup: theirs, out: items.filter((i) => i.from_manager_id === proposerId).map((i) => i.player_id) },
    { managerId: receiverId, lineup: mine, out: items.filter((i) => i.from_manager_id === receiverId).map((i) => i.player_id) },
  );
}

/**
 * The receiver's yes starts the league's review rather than moving anyone. The
 * trade is checked now so a broken one fails at once instead of a day later;
 * a player mid-match only holds it up when it's due to go through.
 */
export async function acceptTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  if (!(await fantasyTradesEnabled())) return { error: TRADES_DISABLED_NOTE };
  const { data: trade } = await supabaseAdmin
    .from("fantasy_trades")
    .select("id, proposer_id, receiver_id, fantasy_trade_items(player_id, from_manager_id)")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .eq("receiver_id", managerId)
    .eq("status", "pending")
    .maybeSingle();
  if (!trade) return { error: "That trade isn't pending any more." };
  const proposerId = trade.proposer_id as string;
  const items = trade.fantasy_trade_items as Items;

  const league = await activeLeagueWithMembers(leagueId, [proposerId, managerId]);
  if ("error" in league) return league;
  if (await frozenProblem(leagueId, managerId, proposerId)) {
    const res = await settle(leagueId, tradeId, ["pending"], "cancelled", FROZEN_TRADE_NOTE, { receiver: managerId });
    if (!("error" in res)) {
      notify([proposerId], "Fantasy trade called off", `Your trade in ${league.name} was cancelled. ${FROZEN_TRADE_NOTE}`, leagueId);
    }
    return { error: `${FROZEN_TRADE_NOTE} The trade has been called off.` };
  }
  const moves = await movesFor(league, proposerId, managerId, items);
  if (typeof moves === "string") {
    const res = await settle(leagueId, tradeId, ["pending"], "failed", moves, { receiver: managerId });
    if (!("error" in res)) {
      notify([proposerId], "Fantasy trade called off", `Your trade in ${league.name} couldn't go through. ${moves}`, leagueId);
    }
    return { error: `${moves} The trade has been called off.` };
  }

  // One player can't be in two trades the league is weighing at once: the
  // first to go through would leave the other's review meaningless.
  const { data: clash } = await supabaseAdmin
    .from("fantasy_trades")
    .select("id, fantasy_trade_items!inner(player_id)")
    .eq("league_id", leagueId)
    .eq("status", "review")
    .neq("id", tradeId)
    .in("fantasy_trade_items.player_id", items.map((i) => i.player_id))
    .limit(1);
  if (clash?.length) {
    return { error: "A player in this trade is already in another trade the league is reviewing. Accept this one once that's settled." };
  }

  const endsAt = new Date(Date.now() + REVIEW_MS).toISOString();
  const { data: moved, error } = await supabaseAdmin
    .from("fantasy_trades")
    .update({ status: "review", review_ends_at: endsAt })
    .eq("id", tradeId)
    .eq("receiver_id", managerId)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: "Couldn't accept that trade. Has scripts/fantasy-trade-review-migration.sql been run?" };
  if (!moved?.length) return { error: "That trade isn't pending any more." };

  const voters = votersOf(await activeManagerIds(leagueId), { proposer_id: proposerId, receiver_id: managerId });
  // With nobody to vote it goes straight through, and that path tells both sides.
  if (!voters.size) {
    await settleReview(tradeId);
    return {};
  }

  const n = await names([proposerId, managerId, ...items.map((i) => i.player_id)]);
  const list = (from: string) =>
    items
      .filter((i) => i.from_manager_id === from)
      .map((i) => n.get(i.player_id) ?? "Unknown")
      .join(", ");
  const proposer = n.get(proposerId) ?? "A manager";
  const receiver = n.get(managerId) ?? "A manager";
  notify(
    [proposerId],
    "Fantasy trade accepted, now in review",
    `${receiver} accepted your trade in ${league.name}. The rest of the league has 24 hours to review it: it's declined if half of them reject it, and goes through sooner if more than half accept.`,
    leagueId,
  );
  notify(
    [...voters],
    "Fantasy trade up for review",
    `${proposer} gets ${list(managerId)} and ${receiver} gets ${list(proposerId)} in ${league.name}. Accept or reject it within 24 hours.`,
    leagueId,
  );
  return {};
}

/** A vote from a manager outside the trade. Changing it is allowed until the trade settles. */
export async function voteOnTrade(leagueId: string, voterId: string, tradeId: string, vote: TradeVote): Promise<Result> {
  if (!(await fantasyTradesEnabled())) return { error: TRADES_DISABLED_NOTE };
  const { data: trade } = await supabaseAdmin
    .from("fantasy_trades")
    .select("proposer_id, receiver_id")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .eq("status", "review")
    .maybeSingle();
  if (!trade) return { error: "That trade isn't up for review any more." };
  if (!votersOf(await activeManagerIds(leagueId), trade).has(voterId)) {
    return { error: "Only the other managers in this league can vote on that trade." };
  }
  const { error } = await supabaseAdmin
    .from("fantasy_trade_votes")
    .upsert({ trade_id: tradeId, account_id: voterId, vote, created_at: new Date().toISOString() }, { onConflict: "trade_id,account_id" });
  if (error) return { error: "Couldn't record that vote. Try again." };
  await settleReview(tradeId);
  return {};
}

/**
 * Decides a trade in review: declined, put through, or left waiting. Safe to
 * race, since every way out of review is pinned to the trade still being in it.
 */
async function settleReview(tradeId: string, now = new Date()): Promise<"veto" | "execute" | "wait" | "gone"> {
  const { data } = await supabaseAdmin
    .from("fantasy_trades")
    .select("id, league_id, proposer_id, receiver_id, review_ends_at, fantasy_trade_items(player_id, from_manager_id)")
    .eq("id", tradeId)
    .eq("status", "review")
    .maybeSingle();
  if (!data) return "gone";
  const trade = data as {
    id: string;
    league_id: string;
    proposer_id: string;
    receiver_id: string;
    review_ends_at: string;
    fantasy_trade_items: Items;
  };
  const leagueId = trade.league_id;
  const parties = [trade.proposer_id, trade.receiver_id];
  const league = await getLeague(leagueId);
  if (!league || league.status !== "active") {
    await settle(leagueId, tradeId, ["review"], "cancelled", "The league's season is over.");
    return "gone";
  }

  const [managers, votes] = await Promise.all([activeManagerIds(leagueId), votesFor([tradeId])]);
  const tally = tallyVotes(votes.get(tradeId) ?? [], votersOf(managers, trade));
  const outcome = reviewOutcome(tally, new Date(trade.review_ends_at), now);
  if (outcome === "wait") return "wait";

  const n = await names(parties);
  const other = (id: string) => n.get(parties.find((p) => p !== id)!) ?? "another manager";
  const tellParties = (title: string, body: (id: string) => string) => {
    for (const id of parties) notify([id], title, body(id), leagueId);
  };

  if (outcome === "veto") {
    const note = `Declined by the league: ${tally.rejects} of ${tally.eligible} managers rejected it.`;
    const res = await settle(leagueId, tradeId, ["review"], "vetoed", note);
    if (!("error" in res)) {
      tellParties("Fantasy trade declined", (id) => `The league declined your trade with ${other(id)} in ${league.name}. ${note.replace("Declined by the league: ", "")}`);
    }
    return "veto";
  }

  if (await frozenProblem(leagueId, trade.proposer_id, trade.receiver_id)) {
    const res = await settle(leagueId, tradeId, ["review"], "cancelled", FROZEN_TRADE_NOTE);
    if (!("error" in res)) tellParties("Fantasy trade called off", () => `Your trade in ${league.name} was cancelled. ${FROZEN_TRADE_NOTE}`);
    return "gone";
  }
  const moves = await movesFor(league, trade.proposer_id, trade.receiver_id, trade.fantasy_trade_items);
  if (typeof moves === "string") {
    const res = await settle(leagueId, tradeId, ["review"], "failed", moves);
    if (!("error" in res)) tellParties("Fantasy trade called off", () => `Your trade in ${league.name} couldn't go through. ${moves}`);
    return "gone";
  }
  // §10: a player mid-match holds it until his series is reported; the next tick retries.
  if ((await lockedPlayerIds(moves.map((m) => m.playerId))).size) return "wait";

  // The RPC cancels these itself, so they're read first to tell both sides.
  const { data: overlapping } = await supabaseAdmin
    .from("fantasy_trades")
    .select("proposer_id, receiver_id, fantasy_trade_items!inner(player_id)")
    .eq("league_id", leagueId)
    .in("status", OPEN)
    .neq("id", tradeId)
    .in("fantasy_trade_items.player_id", moves.map((m) => m.playerId));

  const { data: result, error } = await supabaseAdmin.rpc("fantasy_accept_trade", {
    p_trade: tradeId,
    p_receiver: trade.receiver_id,
    p_players: moves.map((m) => m.playerId),
    p_from_managers: moves.map((m) => m.fromManagerId),
    p_from_slots: moves.map((m) => m.fromSlot),
    p_to_managers: moves.map((m) => m.toManagerId),
    p_to_slots: moves.map((m) => m.toSlot),
  });
  // A roster that changed under it is re-read on the next tick.
  if (error || result === "stale") return "wait";
  if (result !== "ok") return "gone";

  tellParties("Fantasy trade completed", (id) => `Your trade with ${other(id)} in ${league.name} went through.`);
  for (const t of (overlapping ?? []) as { proposer_id: string; receiver_id: string }[]) {
    notify(
      [t.proposer_id, t.receiver_id],
      "Fantasy trade called off",
      `A trade of yours in ${league.name} was cancelled because a player in it was traded first.`,
      leagueId,
    );
  }
  return "execute";
}

/**
 * Cron: settles every trade in review. All of them, not just the expired ones,
 * so a trade the league already passed goes through as soon as a series that
 * held it up is reported.
 */
export async function runTradeReviews(now = new Date()): Promise<string[]> {
  if (!(await fantasyTradesEnabled())) return [];
  const { data } = await supabaseAdmin.from("fantasy_trades").select("id").eq("status", "review");
  const fired: string[] = [];
  for (const { id } of (data ?? []) as { id: string }[]) {
    const outcome = await settleReview(id, now);
    if (outcome === "veto" || outcome === "execute") fired.push(`trade_${outcome}:${id}`);
  }
  return fired;
}
