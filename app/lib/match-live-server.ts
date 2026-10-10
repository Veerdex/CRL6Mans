import { supabaseAdmin } from "@/app/lib/supabase";

// started_at is fetched on its own rather than added to each view's MATCH_SELECT.
// PostgREST fails the whole select when a column is missing, so folding it into
// MATCH_SELECT would blank every bracket in production for the window between the
// deploy and the migration — "No bracket matches found." rather than a missing
// clock. Swallowing the error here degrades to "nothing is live" instead, the same
// way league_settings.draft_pick_message_id degrades pre-migration.
//
// The check-in filters make the booleans, not the stamp, the thing that ends the
// live state: started_at is never cleared, so clearing a check-in by hand would
// otherwise leave the match reading LIVE with a timer running for days.
export async function attachStartedAt<T extends { id: string }>(
  matches: T[],
): Promise<(T & { started_at?: string | null })[]> {
  if (!matches.length) return matches;
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("id, started_at")
    .in("id", matches.map((m) => m.id))
    .not("started_at", "is", null)
    .eq("home_checked_in", true)
    .eq("away_checked_in", true);
  if (error || !data?.length) return matches;
  const byId = new Map(data.map((r) => [r.id as string, r.started_at as string]));
  return matches.map((m) => (byId.has(m.id) ? { ...m, started_at: byId.get(m.id) } : m));
}
