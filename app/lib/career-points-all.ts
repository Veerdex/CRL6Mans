import "server-only";

import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./paginate";
import { careerPoints, type EventKind, type EventPointsInput } from "./career-points";
import { fetchAccoladePrizes } from "./season-accolades";
import type { AccoladeKey } from "./accolades";

/**
 * Career points for every player at once, keyed by discord_id — the bulk form of
 * what loadPlayerProfile computes for one, so the Stats page and the profile
 * modal always show the same number. A table of N players would otherwise cost
 * N profile loads. Like the profile, an accolade only pays when its holder has a
 * result row for that event.
 */
export async function fetchAllCareerPoints(): Promise<Map<string, number>> {
  const [results, accolades, queuePlayers, queueHistory] = await Promise.all([
    fetchAllRows<{
      discord_id: string; event_id: string; placement: number | string;
      team_count: number; prize_pool: number; event_kind: EventKind;
    }>((from, to) =>
      supabaseAdmin
        .from("player_event_results")
        .select("discord_id, event_id, placement, team_count, prize_pool, event_kind")
        .order("discord_id")
        .order("event_id")
        .range(from, to),
    ),
    fetchAllRows<{ discord_id: string; event_id: string; accolade: AccoladeKey }>((from, to) =>
      supabaseAdmin
        .from("season_accolades")
        .select("discord_id, event_id, accolade")
        .order("event_id")
        .order("accolade")
        .range(from, to),
    ),
    fetchAllRows<{ id: string; discord_id: string }>((from, to) =>
      supabaseAdmin
        .from("crl6mansqueuebot_players")
        .select("id, discord_id")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{ player_id: string; season_score: number | null }>((from, to) =>
      supabaseAdmin
        .from("crl6mansqueuebot_season_history")
        .select("player_id, season_score")
        .order("player_id")
        .range(from, to),
    ),
  ]);

  const prizes = await fetchAccoladePrizes([...new Set(accolades.map((a) => a.event_id))]);
  const heldPrizes = new Map<string, number[]>();
  for (const a of accolades) {
    const key = `${a.discord_id}:${a.event_id}`;
    const list = heldPrizes.get(key) ?? [];
    list.push(prizes.get(a.event_id)?.[a.accolade] ?? 0);
    heldPrizes.set(key, list);
  }

  // Null, not zero, for a player with no closed season — careerPoints reads both
  // as nothing, but it keeps the same input the profile passes.
  const sixMansByQueueId = new Map<string, number>();
  for (const h of queueHistory) {
    sixMansByQueueId.set(h.player_id, (sixMansByQueueId.get(h.player_id) ?? 0) + (h.season_score ?? 0));
  }
  const sixMans = new Map<string, number | null>();
  for (const p of queuePlayers) sixMans.set(p.discord_id, sixMansByQueueId.get(p.id) ?? null);

  const events = new Map<string, EventPointsInput[]>();
  for (const r of results) {
    const list = events.get(r.discord_id) ?? [];
    list.push({
      placement: Number(r.placement),
      teamCount: r.team_count,
      prizePool: r.prize_pool,
      kind: r.event_kind,
      accoladePrizes: heldPrizes.get(`${r.discord_id}:${r.event_id}`) ?? [],
    });
    events.set(r.discord_id, list);
  }

  const totals = new Map<string, number>();
  for (const id of new Set([...events.keys(), ...sixMans.keys()])) {
    totals.set(id, careerPoints(sixMans.get(id) ?? null, events.get(id) ?? []));
  }
  return totals;
}
