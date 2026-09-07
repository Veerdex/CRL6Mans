// The four season accolades, hand-awarded by a Director+ rather than computed.
//
// Pure and side-effect-free so the award UI, the server action, and the points
// model all name them identically. Distinct from the per-game stat leaders in
// app/lib/game-stats.ts, which are computed from player_game_stats and shown on
// tournament podiums — these are judgement calls with no statistical source.
//
// `prizeColumn` is the same column name on both `event_accolade_prizes` and
// `league_settings`, which is what lets completeSeason snapshot the live values
// with a plain copy.

export const SEASON_ACCOLADES = [
  { key: "mvp", label: "MVP", short: "MVP", prizeColumn: "accolade_prize_mvp" },
  { key: "offensive", label: "Offensive Player Of The Year", short: "OPOTY", prizeColumn: "accolade_prize_offensive" },
  { key: "defensive", label: "Defensive Player Of The Year", short: "DPOTY", prizeColumn: "accolade_prize_defensive" },
  { key: "rookie", label: "Rookie Of The Year", short: "ROTY", prizeColumn: "accolade_prize_rookie" },
] as const;

export type AccoladeKey = (typeof SEASON_ACCOLADES)[number]["key"];

export const ACCOLADE_KEYS = SEASON_ACCOLADES.map((a) => a.key) as AccoladeKey[];

export const ACCOLADE_PRIZE_COLUMNS = SEASON_ACCOLADES.map((a) => a.prizeColumn);

export type AccoladePrizes = Record<AccoladeKey, number>;

export const NO_ACCOLADE_PRIZES: AccoladePrizes = {
  mvp: 0,
  offensive: 0,
  defensive: 0,
  rookie: 0,
};

export function accoladeMeta(key: AccoladeKey) {
  return SEASON_ACCOLADES.find((a) => a.key === key)!;
}

export function isAccoladeKey(value: string): value is AccoladeKey {
  return (ACCOLADE_KEYS as string[]).includes(value);
}

/** Sort into the canonical MVP → OPOTY → DPOTY → ROTY order. */
export function byAccoladeOrder(a: AccoladeKey, b: AccoladeKey): number {
  return ACCOLADE_KEYS.indexOf(a) - ACCOLADE_KEYS.indexOf(b);
}

/** Read the four prize columns off an `event_accolade_prizes` or `league_settings` row. */
export function prizesFromRow(row: Record<string, unknown> | null | undefined): AccoladePrizes {
  const prizes = { ...NO_ACCOLADE_PRIZES };
  if (!row) return prizes;
  for (const a of SEASON_ACCOLADES) {
    const raw = row[a.prizeColumn];
    prizes[a.key] = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }
  return prizes;
}
