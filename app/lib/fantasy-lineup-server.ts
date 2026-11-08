import "server-only";
import { supabaseAdmin } from "./supabase";
import { getLeague } from "./fantasy-leagues";
import type { FantasyTier } from "./fantasy-pool";
import { LINEUP_SLOTS, type LineupSlot } from "./fantasy-draft";
import { lockedTeams, swapProblem, type LineupEntry, type LockMatch } from "./fantasy-lineup";

// Lineup changes (docs/fantasy-rl.md §4 and §6). The rules are in
// fantasy-lineup.ts; the swap itself is fantasy_swap_slots
// (scripts/fantasy-lineup-migration.sql).

/** Players whose real team is mid-match right now, by the §6 lock window. */
export async function lockedPlayerIds(playerIds: string[]): Promise<Set<string>> {
  if (!playerIds.length) return new Set();
  const { data: players } = await supabaseAdmin.from("players").select("id, team_id").in("id", playerIds);
  const teamOf = new Map(((players ?? []) as { id: string; team_id: string | null }[]).map((p) => [p.id, p.team_id]));
  const teamIds = [...new Set([...teamOf.values()].filter((t): t is string => !!t))];
  if (!teamIds.length) return new Set();

  const ids = teamIds.join(",");
  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, status, scheduled_at")
    .in("status", ["pending", "scheduled"])
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", new Date().toISOString())
    .or(`home_team_id.in.(${ids}),away_team_id.in.(${ids})`);
  const locked = lockedTeams((matches ?? []) as LockMatch[], new Date());
  return new Set(playerIds.filter((id) => locked.has(teamOf.get(id) ?? "")));
}

export async function managerLineup(leagueId: string, fantasySeasonId: string, managerId: string): Promise<LineupEntry[]> {
  const { data: slots } = await supabaseAdmin
    .from("fantasy_roster_slots")
    .select("slot, player_id")
    .eq("league_id", leagueId)
    .eq("manager_id", managerId);
  const rows = (slots ?? []) as { slot: LineupSlot; player_id: string }[];
  const playerIds = rows.map((r) => r.player_id);
  if (!playerIds.length) return [];

  const [{ data: tiers }, locked] = await Promise.all([
    supabaseAdmin.from("fantasy_player_tiers").select("player_id, tier").eq("fantasy_season_id", fantasySeasonId).in("player_id", playerIds),
    lockedPlayerIds(playerIds),
  ]);
  const tierOf = new Map(((tiers ?? []) as { player_id: string; tier: number }[]).map((t) => [t.player_id, Number(t.tier) as FantasyTier]));
  return rows
    .filter((r) => tierOf.has(r.player_id))
    .map((r) => ({ slot: r.slot, playerId: r.player_id, tier: tierOf.get(r.player_id)!, locked: locked.has(r.player_id) }));
}

const isSlot = (s: string): s is LineupSlot => (LINEUP_SLOTS as readonly string[]).includes(s);

export async function moveLineupPlayer(leagueId: string, managerId: string, from: string, to: string): Promise<{ error?: string }> {
  if (!isSlot(from) || !isSlot(to)) return { error: "That isn't a lineup slot." };
  const league = await getLeague(leagueId);
  if (!league) return { error: "That league doesn't exist." };
  // During the draft, fantasy_draft_pick inserts into a slot it chose before
  // taking its lock, so a lineup move in between would make that pick fail.
  if (league.status !== "active") return { error: "Lineups open once the league's draft is finished." };

  const lineup = await managerLineup(leagueId, league.fantasy_season_id, managerId);
  if (!lineup.length) return { error: "You don't have a roster in this league." };
  const problem = swapProblem(lineup, from, to);
  if (problem) return { error: problem };

  const mover = lineup.find((e) => e.slot === from)!;
  const other = lineup.find((e) => e.slot === to);
  const { data, error } = await supabaseAdmin.rpc("fantasy_swap_slots", {
    p_league: leagueId,
    p_manager: managerId,
    p_slot_a: from,
    p_player_a: mover.playerId,
    p_slot_b: to,
    p_player_b: other?.playerId ?? null,
  });
  if (error) return { error: "Couldn't save that lineup change. Try again." };
  if (data !== "ok") return { error: "Your lineup changed in the meantime. Refresh and try again." };
  return {};
}
