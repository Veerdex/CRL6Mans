import "server-only";
import { supabaseAdmin } from "./supabase";

// season_entries is the season's sign-up list. players.draft_entered is the
// live pool that the draft, autopick, subs and pushes read, whichever event is
// running. While no tournament is active the two agree. A tournament's
// activation takes draft_entered over, and its teardown hands it back through
// restoreSeasonPool. That way a season's sign-ups can stay open while
// tournaments come and go without anyone's entry being lost.

export async function tournamentIsActive(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("league_settings").select("active_tournament_id").maybeSingle();
  return !!(data?.active_tournament_id as string | null | undefined);
}

export async function isInSeasonPool(playerId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("season_entries").select("*", { count: "exact", head: true }).eq("player_id", playerId);
  return (count ?? 0) > 0;
}

// Someone already entered keeps their original place, since both formation
// paths order the pool by entry time and cut the tail.
export async function enterSeasonPool(playerIds: string[]): Promise<{ error?: string }> {
  if (!playerIds.length) return {};
  const { error } = await supabaseAdmin
    .from("season_entries")
    .upsert(playerIds.map((player_id) => ({ player_id })), { onConflict: "player_id", ignoreDuplicates: true });
  if (error) return { error: error.message };
  if (!(await tournamentIsActive())) await mirrorEntries(playerIds);
  return {};
}

export async function leaveSeasonPool(playerIds: string[]): Promise<void> {
  if (!playerIds.length) return;
  await supabaseAdmin.from("season_entries").delete().in("player_id", playerIds);
  if (!(await tournamentIsActive())) {
    await supabaseAdmin
      .from("players")
      .update({ draft_entered: false, draft_entered_at: null, updated_at: new Date().toISOString() })
      .in("id", playerIds);
  }
}

/** Hands the live pool back to the season once a tournament stops holding it. */
export async function restoreSeasonPool(): Promise<void> {
  await supabaseAdmin
    .from("players")
    .update({ draft_entered: false, draft_entered_at: null })
    .eq("draft_entered", true);
  await mirrorEntries();
}

export async function clearSeasonPool(): Promise<void> {
  await supabaseAdmin.from("season_entries").delete().not("player_id", "is", null);
}

async function mirrorEntries(playerIds?: string[]): Promise<void> {
  let query = supabaseAdmin.from("season_entries").select("player_id, created_at");
  if (playerIds) query = query.in("player_id", playerIds);
  const { data } = await query;
  const now = new Date().toISOString();
  await Promise.all(
    (data ?? []).map((e) =>
      supabaseAdmin
        .from("players")
        .update({ draft_entered: true, draft_entered_at: e.created_at, updated_at: now })
        .eq("id", e.player_id),
    ),
  );
}
