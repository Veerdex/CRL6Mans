import "server-only";

import { supabaseAdmin } from "./supabase";
import {
  byAccoladeOrder,
  prizesFromRow,
  type AccoladeKey,
  type AccoladePrizes,
} from "./accolades";

export type HeldAccolade = { key: AccoladeKey; prize: number };

// Spelled out rather than joined from ACCOLADE_PRIZE_COLUMNS: supabase-js parses
// the select string as a literal type, and a runtime-built one becomes a
// ParserError. prizesFromRow() is what keeps this in step with accolades.ts.
const PRIZE_SELECT =
  "event_id, accolade_prize_mvp, accolade_prize_offensive, accolade_prize_defensive, accolade_prize_rookie";

/**
 * The accolade prize values for a set of events.
 *
 * Keyed on event_id rather than seasons(id) because that is the key space
 * player_event_results uses, and the backfilled seasons have no `seasons` row —
 * see scripts/season-accolades-migration.sql.
 *
 * Prizes live on the event and are read back here rather than frozen onto the
 * award row, so correcting an event's values corrects everyone who holds one —
 * the same reason career-points.ts stores inputs and recomputes points. Values
 * are per-event, so editing the live season's fields never disturbs a past one.
 */
export async function fetchAccoladePrizes(
  eventIds: string[],
): Promise<Map<string, AccoladePrizes>> {
  if (eventIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("event_accolade_prizes")
    .select(PRIZE_SELECT)
    .in("event_id", eventIds);
  if (error) throw new Error(error.message);

  const byId = new Map<string, AccoladePrizes>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    byId.set(row.event_id as string, prizesFromRow(row));
  }
  return byId;
}

/** Every accolade one player holds, keyed by the event it was awarded for. */
export async function fetchPlayerAccolades(
  discordId: string,
): Promise<Map<string, HeldAccolade[]>> {
  const { data, error } = await supabaseAdmin
    .from("season_accolades")
    .select("event_id, accolade")
    .eq("discord_id", discordId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { event_id: string; accolade: AccoladeKey }[];
  if (rows.length === 0) return new Map();

  const prizes = await fetchAccoladePrizes([...new Set(rows.map((r) => r.event_id))]);

  const byEvent = new Map<string, HeldAccolade[]>();
  for (const row of rows) {
    const held = byEvent.get(row.event_id) ?? [];
    held.push({ key: row.accolade, prize: prizes.get(row.event_id)?.[row.accolade] ?? 0 });
    byEvent.set(row.event_id, held);
  }
  for (const held of byEvent.values()) held.sort((a, b) => byAccoladeOrder(a.key, b.key));
  return byEvent;
}
