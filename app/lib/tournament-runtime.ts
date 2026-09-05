import "server-only";
import { supabaseAdmin } from "./supabase";

/**
 * Make a tournament the single live/active one and bridge its joiners into the
 * global runtime so the existing draft/season machinery operates on it.
 *
 * - Guards that no *other* tournament is already active.
 * - For player-signup tournaments, copies `tournament_entries` → `players.draft_entered`
 *   (preserving join order via `draft_entered_at`) so the existing snake-draft /
 *   auto-balance flow sees the right pool.
 * - Mirrors the tournament's config into `league_settings`.
 *
 * Idempotent: re-running while the tournament is already active (mid draft/season)
 * is a no-op for the pool so it won't wipe an in-progress draft.
 */
export async function activateTournamentRuntime(
  tournamentId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("active_tournament_id, draft_active, season_active")
    .single();

  const activeId = settings?.active_tournament_id as string | null | undefined;
  if (activeId && activeId !== tournamentId)
    return { ok: false, error: "Another tournament is already active." };

  const { data: t } = await supabaseAdmin.from("tournaments").select("*").eq("id", tournamentId).single();
  if (!t) return { ok: false, error: "Tournament not found." };
  if (t.status === "completed" || t.status === "cancelled")
    return { ok: false, error: "Tournament is not joinable." };

  const midRun = settings?.draft_active || settings?.season_active;

  await supabaseAdmin.from("tournaments").update({
    status: "active",
    signups_open: false,
    started_at: t.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", tournamentId);

  // Bridge the player pool into the runtime — only when nothing is mid-run yet.
  if (t.join_mode === "players" && !midRun) {
    const { data: entries } = await supabaseAdmin
      .from("tournament_entries")
      .select("player_id, created_at")
      .eq("tournament_id", tournamentId);

    await supabaseAdmin.from("players")
      .update({ draft_entered: false, in_active_draft: false })
      .eq("status", "approved");

    await Promise.all(
      (entries ?? []).map((e) =>
        supabaseAdmin.from("players")
          .update({ draft_entered: true, draft_entered_at: e.created_at, updated_at: new Date().toISOString() })
          .eq("id", e.player_id)
      )
    );
  }

  // Derive team count from actual sign-ups, capped by team_limit if set.
  let numTeams = 0;
  if (t.join_mode === "players") {
    const { count } = await supabaseAdmin
      .from("tournament_entries")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);
    numTeams = Math.floor((count ?? 0) / 3);
  } else {
    const { count } = await supabaseAdmin
      .from("team_signups")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);
    numTeams = count ?? 0;
  }
  const teamLimit = t.team_limit as number | null | undefined;
  if (teamLimit && teamLimit > 0) numTeams = Math.min(numTeams, teamLimit);

  await supabaseAdmin.from("league_settings").update({
    active_tournament_id: tournamentId,
    num_teams: numTeams,
    stats_enabled: t.stats_enabled ?? true,
    season_format: t.season_format ?? null,
    match_deadline_day: t.match_deadline_day,
    match_play_day: t.match_play_day,
    match_play_hour: t.match_play_hour,
    draft_open: false, // the active tournament's pool is now locked in
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  return { ok: true };
}
