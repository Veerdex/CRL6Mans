import { supabaseAdmin } from "./supabase";

// A forfeit is still stored as 1–0, because advancement, standings and the
// winner highlight all read the score — only the display differs. The flag is
// what tells the two apart, since a bye is stored as 1–0 too and a BO1 stage
// makes 1–0 a legitimate played result.
//
// Read in its own query rather than added to the bracket's select: naming a
// column the migration hasn't added yet fails the whole query, which would
// leave the bracket page blank instead of merely unlabelled. On that error
// every match reads as not-forfeited, which is what the page did before.
export async function attachForfeits<T extends { id: string }>(matches: T[]): Promise<(T & { forfeit: boolean })[]> {
  if (!matches.length) return [];
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id")
    .eq("forfeit", true)
    .in("id", matches.map((m) => m.id));
  const forfeited = new Set((data ?? []).map((m) => m.id));
  return matches.map((m) => ({ ...m, forfeit: forfeited.has(m.id) }));
}
