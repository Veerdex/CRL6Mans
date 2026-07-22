import { supabaseAdmin } from "@/app/lib/supabase";
import { buildResolverContext } from "@/app/lib/replay-identity-context";
import { resolveReplayParticipants, SUSPICIOUS_RESOLUTION_TYPES } from "@/app/lib/replay-identity-resolver";
import { normalizeName } from "@/app/lib/tracker-name";
import type { PlayerStat } from "@/app/lib/replay-parser";
import type { AnalyzedGameStat, SubmittedGame } from "@/app/dashboard/admin/match-actions";

const EXPECTED_ACTIVE_PLAYERS = 6;

export type PlatformIdRescue = { playerId: string; team: "home" | "away" | null };

// Lets a verified platform ID rescue a replay participant whose in-replay name
// doesn't match any registered tracker/username/display name — the exact
// "Aerose-"/"camwin" case that motivated this whole feature. Scoped narrowly:
// this only fills in names that *don't already* resolve by name. It does not
// override an existing name match, even a contradictory one — that stronger
// rule ("a contradictory platform ID can never fall back to a name match")
// needs an admin-adjudication surface (Step 8) and is out of scope here.
export async function resolvePlatformIdMatches(
  matchId: string,
  activePlayers: PlayerStat[],
): Promise<Map<string, PlatformIdRescue>> {
  const rescues = new Map<string, PlatformIdRescue>();
  try {
    const context = await buildResolverContext(matchId, activePlayers);
    if (!context) return rescues;

    const resolution = resolveReplayParticipants({
      replayPlayers: activePlayers,
      expectedLineup: context.expectedLineup,
      currentlyEligiblePlayerIds: context.currentlyEligiblePlayerIds,
      kickoffAt: context.kickoffAt,
      globalVerifiedAccounts: context.globalVerifiedAccounts,
    });

    for (const p of resolution.players) {
      if (p.type === "matched-by-platform-id" && p.playerId) {
        rescues.set(normalizeName(p.replayName), { playerId: p.playerId, team: p.expectedTeam });
      }
    }
  } catch (err) {
    console.error(`[identity-resolver] platform-id rescue lookup failed for match ${matchId}:`, err);
  }
  return rescues;
}

// Evaluates one analyzed replay against the Step 6 resolver and persists the
// verdict (Step 7). Never blocks the analyze-time call — callers still return
// stats to the client immediately. The hard block happens later, at series/
// match submission, via resolveSubmittedGames below.
//
// This never checks missingExpectedPlayers: every snapshot in this codebase
// uses lineup_mode 'eligible_roster' (no exact pre-kickoff lineup UI exists),
// so a roster member simply not playing a given game is normal, not evidence
// of anything wrong.
export async function evaluateAndPersistGameCertification(input: {
  matchId: string;
  gameNumber: number;
  replayId: string | null;
  activePlayers: PlayerStat[];
  stats: AnalyzedGameStat[];
  homeTeamWon: boolean;
}): Promise<{ certified: boolean; reason?: string }> {
  const { matchId, gameNumber, replayId, activePlayers, stats, homeTeamWon } = input;

  let certified = false;
  let reason = "Could not verify roster snapshot for this match";

  try {
    const context = await buildResolverContext(matchId, activePlayers);
    if (context) {
      const resolution = resolveReplayParticipants({
        replayPlayers: activePlayers,
        expectedLineup: context.expectedLineup,
        currentlyEligiblePlayerIds: context.currentlyEligiblePlayerIds,
        kickoffAt: context.kickoffAt,
        globalVerifiedAccounts: context.globalVerifiedAccounts,
      });

      const flagged = resolution.players.filter(p => SUSPICIOUS_RESOLUTION_TYPES.has(p.type));
      if (flagged.length) {
        console.warn(
          `[identity-resolver][shadow] match ${matchId} game ${gameNumber}:`,
          JSON.stringify({ flagged, missingExpectedPlayers: resolution.missingExpectedPlayers }),
        );
      }

      if (activePlayers.length !== EXPECTED_ACTIVE_PLAYERS) {
        reason = `Expected ${EXPECTED_ACTIVE_PLAYERS} active players, found ${activePlayers.length}`;
      } else if (!resolution.players.every(p => p.type === "matched-by-platform-id")) {
        reason = "One or more players did not resolve to a certified platform identity";
      } else {
        certified = true;
        reason = "All active players resolved by verified platform ID";
      }

      if (replayId) {
        // Only clear still-open rows — a re-analysis (e.g. after an admin
        // corrects the underlying data per Step 8) must not erase the
        // resolved_by/resolution/resolved_at audit trail on rows an admin
        // already adjudicated. Resolved rows persist as permanent history.
        await supabaseAdmin
          .from("replay_identity_discrepancies")
          .delete()
          .eq("replay_id", replayId)
          .eq("status", "open");
        if (!certified) {
          const rows = resolution.players
            .filter(p => p.type !== "matched-by-platform-id")
            .map(p => ({
              match_id: matchId,
              replay_id: replayId,
              game_number: gameNumber,
              replay_player_name: p.replayName,
              replay_team: p.replayTeam,
              replay_platform: p.platform,
              replay_platform_account_id: p.onlineId,
              identity_source: p.identitySource,
              expected_player_id: p.playerId,
              conflicting_player_id: p.conflictingPlayerId,
              reason: p.reason,
              status: "open" as const,
              evidence_json: p,
            }));
          if (rows.length) await supabaseAdmin.from("replay_identity_discrepancies").insert(rows);
        }
      }
    }
  } catch (err) {
    console.error(`[identity-resolver] failed for match ${matchId}:`, err);
    reason = "Identity resolution failed unexpectedly";
  }

  // Nothing reliable to key a later gate lookup on without a replay_id — skip
  // persisting a certification row (the submission gate fails closed on a
  // missing record, so this replay simply can never certify).
  if (replayId) {
    // Kept only long enough for a later admin reverify pass (see
    // reverifyGameIdentity) to re-run the resolver without needing the
    // original file re-uploaded — cleared once certified, since a certified
    // replay has nothing left to reverify.
    const playerResolutionsForReverify = certified
      ? null
      : activePlayers.map(({ name, team, platform, onlineId, identityKey, identitySource }) => ({
          name, team, platform, onlineId, identityKey, identitySource,
        }));

    await supabaseAdmin.from("replay_identity_certifications").upsert(
      {
        replay_id: replayId,
        match_id: matchId,
        game_number: gameNumber,
        certified,
        reason,
        home_team_won: homeTeamWon,
        stats_json: stats,
        player_resolutions_json: playerResolutionsForReverify,
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "replay_id" },
    );
  }

  return { certified, reason };
}

// Step 8: guards every path that can finalize an already-pending match
// (opposing-captain confirm, the 5-minute auto-confirm timeout) against
// clearing an identity discrepancy. submitSeriesResult/reportMatchResult
// already gate at submission, but a discrepancy can appear afterward — e.g. a
// stray replay re-upload for this match while confirmation is pending — so
// finalization paths must re-check rather than trust the earlier gate.
export async function hasBlockingIdentityDiscrepancy(matchId: string): Promise<boolean> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("identity_enforcement_enabled")
    .single();
  if (!settings?.identity_enforcement_enabled) return false;

  const { data: openDiscrepancy } = await supabaseAdmin
    .from("replay_identity_discrepancies")
    .select("id")
    .eq("match_id", matchId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  return !!openDiscrepancy;
}

// Whole-match gate, run at series/match submission (Step 7). Looks up the
// certification persisted for each submitted game by replay_id — never by the
// client-supplied game_number — so a client can't relabel a certified replay
// as a different game slot and smuggle tampered stats through.
//
// Always computes identityStatus for visibility, even when enforcement is
// off, so matches.identity_status carries real signal ahead of Step 8's
// adjudication UI. Only blocks the caller when identity_enforcement_enabled
// is true in league_settings.
export async function resolveSubmittedGames(
  matchId: string,
  clientGames: SubmittedGame[],
): Promise<
  | { ok: true; games: SubmittedGame[]; identityStatus: "pending" | "certified" | "review_required" }
  | { ok: false; message: string; identityStatus: "review_required" }
> {
  if (clientGames.length === 0) {
    return { ok: true, games: [], identityStatus: "pending" };
  }

  const replayIds = clientGames.map(g => g.replayId).filter((id): id is string => !!id);
  const { data: certRows } = replayIds.length
    ? await supabaseAdmin
        .from("replay_identity_certifications")
        .select("replay_id, match_id, game_number, certified, stats_json")
        .in("replay_id", replayIds)
    : { data: [] as never[] };

  const certByReplayId = new Map(
    (certRows ?? []).map(r => [r.replay_id as string, r as {
      replay_id: string; match_id: string; game_number: number; certified: boolean; stats_json: AnalyzedGameStat[];
    }]),
  );

  const allCertified = clientGames.every(g => {
    if (!g.replayId) return false;
    const row = certByReplayId.get(g.replayId);
    return !!row && row.certified && row.match_id === matchId && row.game_number === g.gameNumber;
  });

  const identityStatus = allCertified ? "certified" : "review_required";

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("identity_enforcement_enabled")
    .single();

  if (settings?.identity_enforcement_enabled && !allCertified) {
    return {
      ok: false,
      message: "One or more games in this series failed platform-identity verification and require admin review before this match can be completed.",
      identityStatus: "review_required",
    };
  }

  // Prefer server-persisted, resolver-checked stats over the client payload
  // wherever a certification record exists. Games with no record (enforcement
  // off, or a replay that was never analyzed through the resolver) fall back
  // to whatever the client submitted, exactly as before Step 7.
  const games = clientGames.map(g => {
    const row = g.replayId ? certByReplayId.get(g.replayId) : undefined;
    return row ? { gameNumber: g.gameNumber, replayId: g.replayId, stats: row.stats_json } : g;
  });

  return { ok: true, games, identityStatus };
}
