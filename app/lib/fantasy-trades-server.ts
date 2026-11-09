import "server-only";
import { supabaseAdmin } from "./supabase";
import { getLeague, type LeagueRow } from "./fantasy-leagues";
import { accountNames, notifyManagers } from "./fantasy-notify";
import { lockedPlayerIds, managerLineup } from "./fantasy-lineup-server";
import { tradeMoves, tradeShapeProblem, type TradeStatus, type TradeView } from "./fantasy-trades";
import { eliminatedInLeague } from "./fantasy-matchup-server";
import { FROZEN_NOTE } from "./fantasy-schedule";
import { TRADES_DISABLED_NOTE } from "./fantasy-rules";

// Trades (docs/fantasy-rl.md §10). The rules are in fantasy-trades.ts; the
// move itself is fantasy_accept_trade (scripts/fantasy-trades-migration.sql).

type Result = { error?: string };

/** The director's switch for every league. A read error (pre-migration) is off. */
export async function fantasyTradesEnabled(): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("league_settings").select("fantasy_trades_enabled").single();
  return !error && data?.fantasy_trades_enabled === true;
}

/**
 * Turning trades off cancels every pending one, so turning them back on later
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
      .eq("status", "pending");
  }
  return {};
}

const RECENT_MS = 7 * 24 * 3600_000;

/** The manager's pending trades, then the last week's settled ones, newest first. */
export async function managerTrades(leagueId: string, managerId: string): Promise<TradeView[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_trades")
    .select(
      "id, proposer_id, receiver_id, status, note, created_at, resolved_at, proposer_dismissed, receiver_dismissed, fantasy_trade_items(player_id, from_manager_id)",
    )
    .eq("league_id", leagueId)
    .or(`proposer_id.eq.${managerId},receiver_id.eq.${managerId}`)
    .order("created_at", { ascending: false })
    .limit(40);
  type Row = {
    id: string;
    proposer_id: string;
    receiver_id: string;
    status: TradeStatus;
    note: string | null;
    created_at: string;
    resolved_at: string | null;
    proposer_dismissed: boolean;
    receiver_dismissed: boolean;
    fantasy_trade_items: { player_id: string; from_manager_id: string }[];
  };
  const visible = ((data ?? []) as Row[]).filter((t) =>
    t.proposer_id === managerId ? !t.proposer_dismissed : !t.receiver_dismissed,
  );
  const trades = visible.map((t) => ({
    id: t.id,
    proposerId: t.proposer_id,
    receiverId: t.receiver_id,
    status: t.status,
    note: t.note,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
    items: t.fantasy_trade_items.map((i) => ({ playerId: i.player_id, fromManagerId: i.from_manager_id })),
  }));
  const since = Date.now() - RECENT_MS;
  return [
    ...trades.filter((t) => t.status === "pending"),
    ...trades.filter((t) => t.status !== "pending" && t.resolvedAt && new Date(t.resolvedAt).getTime() >= since),
  ];
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

/** §7/§10: a pending trade is called off once either side is eliminated. */
export async function cancelFrozenTrades(leagueId: string, eliminated: Set<string>): Promise<void> {
  if (!eliminated.size) return;
  const ids = [...eliminated].join(",");
  const { data, error } = await supabaseAdmin
    .from("fantasy_trades")
    .update({ status: "cancelled", note: FROZEN_TRADE_NOTE, resolved_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .or(`proposer_id.in.(${ids}),receiver_id.in.(${ids})`)
    .select("proposer_id, receiver_id");
  if (error) return console.error(`[fantasy] cancelling frozen trades in ${leagueId} failed: ${error.message}`);
  // Only the rows this call moved off pending come back, so a page load that
  // finds nothing left to cancel notifies nobody.
  const rows = (data ?? []) as { proposer_id: string; receiver_id: string }[];
  if (rows.length) {
    notify(
      rows.flatMap((r) => [r.proposer_id, r.receiver_id]),
      "Fantasy trade called off",
      `A pending trade of yours was cancelled. ${FROZEN_TRADE_NOTE}`,
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

async function settle(
  leagueId: string,
  tradeId: string,
  status: TradeStatus,
  note: string | null,
  where: { receiver?: string; either?: string },
) {
  let q = supabaseAdmin
    .from("fantasy_trades")
    .update({ status, note, resolved_at: new Date().toISOString() })
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .eq("status", "pending");
  if (where.receiver) q = q.eq("receiver_id", where.receiver);
  if (where.either) q = q.or(`proposer_id.eq.${where.either},receiver_id.eq.${where.either}`);
  const { data, error } = await q.select("proposer_id, receiver_id");
  if (error) return { error: "Couldn't update that trade. Try again." };
  if (!data?.length) return { error: "That trade isn't pending any more." };
  const row = data[0] as { proposer_id: string; receiver_id: string };
  return { proposerId: row.proposer_id, receiverId: row.receiver_id };
}

/** Either manager can cancel a pending trade. */
export async function cancelTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  const res = await settle(leagueId, tradeId, "cancelled", null, { either: managerId });
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
    .neq("status", "pending")
    .maybeSingle();
  if (!data || (data.proposer_id !== managerId && data.receiver_id !== managerId)) {
    return { error: "That trade can't be dismissed." };
  }
  const column = data.proposer_id === managerId ? "proposer_dismissed" : "receiver_dismissed";
  const { error } = await supabaseAdmin.from("fantasy_trades").update({ [column]: true }).eq("id", tradeId);
  return error ? { error: "Couldn't dismiss that trade. Try again." } : {};
}

export async function rejectTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  const res = await settle(leagueId, tradeId, "rejected", null, { receiver: managerId });
  if ("error" in res) return res;
  const league = await getLeague(leagueId);
  const n = await names([managerId]);
  notify([res.proposerId], "Fantasy trade rejected", `${n.get(managerId)} rejected your trade in ${league?.name ?? "your league"}.`, leagueId);
  return {};
}

export async function acceptTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  if (!(await fantasyTradesEnabled())) return { error: TRADES_DISABLED_NOTE };
  const { data: trade } = await supabaseAdmin
    .from("fantasy_trades")
    .select("id, league_id, proposer_id, receiver_id, fantasy_trade_items(player_id, from_manager_id)")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .eq("receiver_id", managerId)
    .eq("status", "pending")
    .maybeSingle();
  if (!trade) return { error: "That trade isn't pending any more." };
  const proposerId = trade.proposer_id as string;
  const items = trade.fantasy_trade_items as { player_id: string; from_manager_id: string }[];

  const league = await activeLeagueWithMembers(leagueId, [proposerId, managerId]);
  if ("error" in league) return league;
  if (await frozenProblem(leagueId, managerId, proposerId)) {
    const res = await settle(leagueId, tradeId, "cancelled", FROZEN_TRADE_NOTE, { receiver: managerId });
    if (!("error" in res)) {
      notify([proposerId], "Fantasy trade called off", `Your trade in ${league.name} was cancelled. ${FROZEN_TRADE_NOTE}`, leagueId);
    }
    return { error: `${FROZEN_TRADE_NOTE} The trade has been called off.` };
  }

  const [theirs, mine, locked] = await Promise.all([
    managerLineup(leagueId, league.fantasy_season_id, proposerId),
    managerLineup(leagueId, league.fantasy_season_id, managerId),
    lockedPlayerIds(items.map((i) => i.player_id)),
  ]);
  const moves = tradeMoves(
    { managerId: proposerId, lineup: theirs, out: items.filter((i) => i.from_manager_id === proposerId).map((i) => i.player_id) },
    { managerId, lineup: mine, out: items.filter((i) => i.from_manager_id === managerId).map((i) => i.player_id) },
  );
  if (typeof moves === "string") {
    const res = await settle(leagueId, tradeId, "failed", moves, { receiver: managerId });
    if (!("error" in res)) {
      notify([proposerId], "Fantasy trade called off", `Your trade in ${league.name} couldn't go through. ${moves}`, leagueId);
    }
    return { error: `${moves} The trade has been called off.` };
  }
  // §10: it stays pending until the series is reported.
  if (locked.size) return { error: "A player in this trade is mid-match. Accept it once his series is reported." };

  // The RPC cancels these itself, so they're read first to tell both sides.
  const { data: overlapping } = await supabaseAdmin
    .from("fantasy_trades")
    .select("proposer_id, receiver_id, fantasy_trade_items!inner(player_id)")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .neq("id", tradeId)
    .in("fantasy_trade_items.player_id", moves.map((m) => m.playerId));

  const { data: outcome, error } = await supabaseAdmin.rpc("fantasy_accept_trade", {
    p_trade: tradeId,
    p_receiver: managerId,
    p_players: moves.map((m) => m.playerId),
    p_from_managers: moves.map((m) => m.fromManagerId),
    p_from_slots: moves.map((m) => m.fromSlot),
    p_to_managers: moves.map((m) => m.toManagerId),
    p_to_slots: moves.map((m) => m.toSlot),
  });
  if (error) return { error: "Couldn't complete that trade. Try again." };
  if (outcome === "gone") return { error: "That trade isn't pending any more." };
  if (outcome !== "ok") return { error: "A roster changed in the meantime. Refresh and try again." };

  const n = await names([managerId]);
  notify([proposerId], "Fantasy trade accepted", `${n.get(managerId)} accepted your trade in ${league.name}.`, leagueId);
  for (const t of (overlapping ?? []) as { proposer_id: string; receiver_id: string }[]) {
    notify(
      [t.proposer_id, t.receiver_id],
      "Fantasy trade called off",
      `A pending trade of yours in ${league.name} was cancelled because a player in it was traded first.`,
      leagueId,
    );
  }
  return {};
}
