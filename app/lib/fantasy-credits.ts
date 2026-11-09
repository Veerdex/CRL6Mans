import { supabaseAdmin } from "./supabase";
import { GROUP_STAGE_PREFIX } from "./bracket";
import { isStarterSlot, type LineupSlot } from "./fantasy-draft";
import { waiverClearsAt } from "./fantasy-waivers";

// Fantasy slot credits (docs/fantasy-rl.md §6): when a group-stage series is
// reported, every rostered starter whose team played it fills the slot they
// sit in for that week, unless the slot is already filled. Bench players earn
// nothing. Imported by discord-bot.ts, so it stays clear of the fantasy server
// modules that would import back into it.

type CreditMatch = {
  id: string;
  round: number | null;
  forfeit: boolean | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

/** Call after the series is claimed as completed. Forfeits and non-group stages are skipped here, so any caller can pass any match. */
export async function creditFantasySlots(matchIds: string[]): Promise<void> {
  if (!matchIds.length) return;
  const { data: matchRows } = await supabaseAdmin
    .from("matches")
    .select("id, round, forfeit, home_team_id, away_team_id")
    .in("id", matchIds)
    .eq("status", "completed")
    .like("stage", `${GROUP_STAGE_PREFIX}%`);
  const played = ((matchRows ?? []) as CreditMatch[]).filter(
    (m) => !m.forfeit && m.round && m.home_team_id && m.away_team_id,
  );
  if (!played.length) return;

  const { data: seasons } = await supabaseAdmin.from("fantasy_seasons").select("id").neq("status", "complete");
  const seasonIds = ((seasons ?? []) as { id: string }[]).map((s) => s.id);
  if (!seasonIds.length) return;
  const { data: leagues } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id, fantasy_season_id")
    .in("fantasy_season_id", seasonIds)
    .eq("status", "active");
  const leagueRows = (leagues ?? []) as { id: string; fantasy_season_id: string }[];
  const leagueIds = leagueRows.map((l) => l.id);
  if (!leagueIds.length) return;

  const matchOfTeam = new Map<string, CreditMatch>();
  for (const m of played) {
    matchOfTeam.set(m.home_team_id!, m);
    matchOfTeam.set(m.away_team_id!, m);
  }
  const { data: players } = await supabaseAdmin.from("players").select("id, team_id").in("team_id", [...matchOfTeam.keys()]);
  const teamOf = new Map(((players ?? []) as { id: string; team_id: string }[]).map((p) => [p.id, p.team_id]));
  if (!teamOf.size) return;

  const { data: slots } = await supabaseAdmin
    .from("fantasy_roster_slots")
    .select("league_id, manager_id, slot, player_id")
    .in("league_id", leagueIds)
    .in("player_id", [...teamOf.keys()]);

  const slotRows = (slots ?? []) as { league_id: string; manager_id: string; slot: LineupSlot; player_id: string }[];
  await putReportedOnWaivers(leagueRows, [...teamOf.keys()], slotRows);

  const credits = slotRows
    .filter((s) => isStarterSlot(s.slot))
    .map((s) => {
      const teamId = teamOf.get(s.player_id)!;
      const match = matchOfTeam.get(teamId)!;
      return {
        league_id: s.league_id,
        manager_id: s.manager_id,
        week: match.round!,
        slot: s.slot,
        player_id: s.player_id,
        match_id: match.id,
        team_id: teamId,
      };
    });
  if (!credits.length) return;

  const { error } = await supabaseAdmin
    .from("fantasy_slot_credits")
    .upsert(credits, { onConflict: "league_id,manager_id,week,slot", ignoreDuplicates: true });
  if (error) console.error(`[fantasy] slot credits for ${matchIds.join(",")} failed: ${error.message}`);
}

/**
 * §9: a player goes on waivers when his series is reported, and playing again
 * restarts his waivers. Only players in a league's frozen pool and on nobody's
 * roster there; a rostered player goes on waivers only when he's dropped.
 */
async function putReportedOnWaivers(
  leagues: { id: string; fantasy_season_id: string }[],
  playerIds: string[],
  slots: { league_id: string; player_id: string }[],
): Promise<void> {
  const seasonIds = [...new Set(leagues.map((l) => l.fantasy_season_id))];
  const { data: tiers } = await supabaseAdmin
    .from("fantasy_player_tiers")
    .select("fantasy_season_id, player_id")
    .in("fantasy_season_id", seasonIds)
    .in("player_id", playerIds);
  const pool = new Set(((tiers ?? []) as { fantasy_season_id: string; player_id: string }[]).map((t) => `${t.fantasy_season_id}:${t.player_id}`));
  const rostered = new Set(slots.map((s) => `${s.league_id}:${s.player_id}`));
  const clearsAt = waiverClearsAt(new Date()).toISOString();
  const rows = leagues.flatMap((l) =>
    playerIds
      .filter((p) => pool.has(`${l.fantasy_season_id}:${p}`) && !rostered.has(`${l.id}:${p}`))
      .map((p) => ({ league_id: l.id, player_id: p, clears_at: clearsAt })),
  );
  if (!rows.length) return;
  const { error } = await supabaseAdmin.from("fantasy_waivers").upsert(rows, { onConflict: "league_id,player_id" });
  if (error) console.error(`[fantasy] waivers for reported players failed: ${error.message}`);
}
