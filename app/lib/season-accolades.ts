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
  "id, accolade_prize_mvp, accolade_prize_offensive, accolade_prize_defensive, accolade_prize_rookie";

/**
 * The accolade prize values for a set of archived seasons.
 *
 * Prizes live on the season and are read back here rather than frozen onto the
 * award row, so correcting a season's values corrects everyone who holds one —
 * the same reason career-points.ts stores inputs and recomputes points. Values
 * are per-season, so editing the live season's fields never disturbs a past one.
 */
export async function fetchAccoladePrizes(
  seasonIds: string[],
): Promise<Map<string, AccoladePrizes>> {
  if (seasonIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("seasons")
    .select(PRIZE_SELECT)
    .in("id", seasonIds);
  if (error) throw new Error(error.message);

  const byId = new Map<string, AccoladePrizes>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    byId.set(row.id as string, prizesFromRow(row));
  }
  return byId;
}

/** Every accolade one player holds, keyed by the season it was awarded for. */
export async function fetchPlayerAccolades(
  discordId: string,
): Promise<Map<string, HeldAccolade[]>> {
  const { data, error } = await supabaseAdmin
    .from("season_accolades")
    .select("season_id, accolade")
    .eq("discord_id", discordId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { season_id: string; accolade: AccoladeKey }[];
  if (rows.length === 0) return new Map();

  const prizes = await fetchAccoladePrizes([...new Set(rows.map((r) => r.season_id))]);

  const bySeason = new Map<string, HeldAccolade[]>();
  for (const row of rows) {
    const held = bySeason.get(row.season_id) ?? [];
    held.push({ key: row.accolade, prize: prizes.get(row.season_id)?.[row.accolade] ?? 0 });
    bySeason.set(row.season_id, held);
  }
  for (const held of bySeason.values()) held.sort((a, b) => byAccoladeOrder(a.key, b.key));
  return bySeason;
}
