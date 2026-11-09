import "server-only";
import { supabaseAdmin } from "./supabase";
import { accountName, getLeague, type LeagueRow } from "./fantasy-leagues";
import { lockedPlayerIds, managerLineup } from "./fantasy-lineup-server";
import { tradeMoves, tradeShapeProblem, type TradeStatus, type TradeView } from "./fantasy-trades";
import { recordNotification } from "./notifications";

// Trades (docs/fantasy-rl.md §10). The rules are in fantasy-trades.ts; the
// move itself is fantasy_accept_trade (scripts/fantasy-trades-migration.sql).

type Result = { error?: string };

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
    .in("account_id", managerIds);
  if ((data ?? []).length !== new Set(managerIds).size) return { error: "Both managers have to be in this league." };
  return league;
}

async function notify(accountIds: string[], title: string, body: string, leagueId: string): Promise<void> {
  const { data } = await supabaseAdmin.from("accounts").select("discord_id").in("id", accountIds);
  const discordIds = ((data ?? []) as { discord_id: string }[]).map((a) => a.discord_id);
  if (discordIds.length) await recordNotification({ kind: "users", discordIds }, { title, body, url: `/dashboard/fantasy/${leagueId}/players` });
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from("accounts").select("id, username, display_name").in("id", ids);
  return new Map(((data ?? []) as { id: string; username: string | null; display_name: string | null }[]).map((a) => [a.id, accountName(a)]));
}

export async function proposeTrade(
  leagueId: string,
  proposerId: string,
  receiverId: string,
  giveIds: string[],
  getIds: string[],
): Promise<Result> {
  if (proposerId === receiverId) return { error: "You can't trade with yourself." };
  const give = [...new Set(giveIds)];
  const get = [...new Set(getIds)];
  const league = await activeLeagueWithMembers(leagueId, [proposerId, receiverId]);
  if ("error" in league) return league;

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
  await notify(
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
  const { data, error } = await q.select("proposer_id");
  if (error) return { error: "Couldn't update that trade. Try again." };
  if (!data?.length) return { error: "That trade isn't pending any more." };
  return { proposerId: (data[0] as { proposer_id: string }).proposer_id };
}

/** Either manager can cancel a pending trade. */
export async function cancelTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
  const res = await settle(leagueId, tradeId, "cancelled", null, { either: managerId });
  return "error" in res ? res : {};
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
  await notify([res.proposerId], "Fantasy trade rejected", `${n.get(managerId)} rejected your trade in ${league?.name ?? "your league"}.`, leagueId);
  return {};
}

export async function acceptTrade(leagueId: string, managerId: string, tradeId: string): Promise<Result> {
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
    await settle(leagueId, tradeId, "failed", moves, { receiver: managerId });
    return { error: `${moves} The trade has been called off.` };
  }
  // §10: it stays pending until the series is reported.
  if (locked.size) return { error: "A player in this trade is mid-match. Accept it once his series is reported." };

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
  await notify([proposerId], "Fantasy trade accepted", `${n.get(managerId)} accepted your trade in ${league.name}.`, leagueId);
  return {};
}
