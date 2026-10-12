import { supabaseAdmin } from "./supabase";

// A forfeit is still stored as 1–0 (or the full best-of, from a disqualification),
// because advancement, standings and the winner highlight all read the score —
// only the display and the game-win tallies differ. The flag is what tells the
// two apart, since a bye is stored as 1–0 too and a BO1 stage makes 1–0 a
// legitimate played result.
//
// Read in its own query rather than added to each caller's select: naming a
// column the migration hasn't added yet fails the whole query, which would blank
// the bracket page and stall a group stage's advancement. On that error every
// match reads as not-forfeited, which is what the code did before the column.
//
// Fetched as "every forfeited row" rather than filtered by the ids in hand: a
// forfeit is rare and `matches` holds one event at a time, so this is a handful
// of rows either way — and it keeps a large archive's worth of ids out of the
// request URL.
async function forfeitedMatchIds(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("matches").select("id").eq("forfeit", true);
  return new Set((data ?? []).map((m) => m.id as string));
}

export async function attachForfeits<T extends { id: string }>(matches: T[]): Promise<(T & { forfeit: boolean })[]> {
  if (!matches.length) return [];
  const forfeited = await forfeitedMatchIds();
  return matches.map((m) => ({ ...m, forfeit: forfeited.has(m.id) }));
}
