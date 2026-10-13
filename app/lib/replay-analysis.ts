// Reading a game out of a .replay file, shared by the website's upload action
// and the bot's /report. The body is `uploadGameReplay`'s, lifted here so both
// surfaces interpret a replay identically; the website's wrapper keeps the
// `File` handling (extension, MAX_REPLAY_BYTES) because that cap is Vercel's
// request-body limit and a Discord attachment never passes through our function.
//
// Deliberately not a `"use server"` file: every export there is a callable
// endpoint, and `analyzeGameReplay(teamId, …)` as an endpoint would let anyone
// analyse a replay against any team.
//
// Split into analyse and persist at what used to be one call. Analysis only
// reads, so a report that fails a later check — "the series was already decided
// before game 4" — leaves nothing behind; the website uploads one game at a time
// and persists immediately, so that path is unchanged, while /report analyses
// the whole series before writing anything. It matters because
// `getUnmatchedByGame` reads every certification row for the match: a rejected
// attempt that had already written them would warn the other team about players
// from a submission that never happened, and on strict would route the next
// clean submission to admin review.

import { supabaseAdmin } from "@/app/lib/supabase";
import { parseReplay } from "@/app/lib/replay-parser";
import { resolveTrackerName, normalizeName } from "@/app/lib/tracker-name";
import { ensureMatchIdentitySnapshot } from "@/app/lib/match-identity-snapshot";
import { resolveTeamSize, teamSizeLabel } from "@/app/lib/team-size";
import {
  evaluateAndPersistGameCertification,
  resolvePlatformIdMatches,
} from "@/app/lib/replay-identity-certification";
import type { AnalyzedGameStat } from "@/app/dashboard/admin/match-actions";
import type { PlayerStat } from "@/app/lib/replay-parser";

export type GameAnalysis = {
  homeTeamWon: boolean;
  replayId: string | null;
  stats: AnalyzedGameStat[];
  unmatchedNames: string[];
  // The lobby as the replay gave it, carried rather than rebuilt from `stats`:
  // the certification resolver reads `team`, `platform` and `onlineId` off these
  // rows, and platform-ID certification is exactly what a rebuild would break.
  activePlayers: PlayerStat[];
};

// Neither side may report a tournament result until both teams have checked in.
// Keyed on the match's own checkin_deadline rather than league_settings.active_tournament_id
// so it fails open: a season match never gets a deadline stamped, and a tournament match
// whose window openCheckInForMatch hasn't opened yet (the admin hasn't scheduled the stage
// start, or the cron hasn't run) stays reportable instead of being stuck with no override.
export function checkInGate(m: {
  checkin_deadline: string | null;
  home_checked_in: boolean | null;
  away_checked_in: boolean | null;
}): string | null {
  if (!m.checkin_deadline) return null;
  if (m.home_checked_in && m.away_checked_in) return null;
  return "Both teams have to check in before the result can be reported.";
}

export async function analyzeGameReplay(args: {
  teamId: string;
  matchId: string;
  gameNumber: number;
  bytes: Buffer;
}): Promise<GameAnalysis | { error: string }> {
  const { teamId, matchId, gameNumber, bytes } = args;

  let replayData;
  try {
    replayData = parseReplay(bytes);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse replay" };
  }

  if (replayData.team0Score === replayData.team1Score)
    return { error: "Replay shows a tied game — please check the file" };

  // Casters appear in the replay with 0 score — exclude them before any validation.
  const activePlayers = replayData.players.filter((p) => p.score > 0);

  // A league game is a full lobby at the event's own size. Reject replays that
  // aren't that many per side — someone left, or a 2v2 was uploaded to a 3v3.
  // Admin-side uploads bypass this entirely.
  //
  // The size comes from league_settings via resolveTeamSize, never a local `?? 3`:
  // seasons are 3v3, but a tournament authors its own team_size and
  // activateTournamentRuntime mirrors it in, so a hardcoded 3 rejected every
  // replay of a 1v1 or 2v2 event outright.
  const playersPerTeam = await resolveTeamSize();
  const team0Count = activePlayers.filter((p) => p.team === 0).length;
  const team1Count = activePlayers.filter((p) => p.team === 1).length;
  if (team0Count !== playersPerTeam || team1Count !== playersPerTeam)
    return {
      // Both counts are of the same filtered lobby. Using the raw player count
      // for the total would contradict the sides it just named whenever a caster
      // was present — and at 1v1 a single caster is a third of the lobby.
      error: `This replay is ${team0Count}v${team1Count} (${activePlayers.length} player${activePlayers.length === 1 ? "" : "s"}) — a valid game must be ${teamSizeLabel(playersPerTeam)} with ${playersPerTeam * 2} players.`,
    };

  // Reject duplicates already committed to the DB (another match, or a prior
  // submission of this series). Same-session dupes are caught by the caller:
  // the website's panel client-side, /report by replay ID across its slots.
  if (replayData.replayId) {
    const { data: existing } = await supabaseAdmin
      .from("player_game_stats")
      .select("match_id, game_number")
      .eq("replay_id", replayData.replayId)
      .limit(50);
    const conflict = (existing ?? []).find(
      (r) => !(r.match_id === matchId && r.game_number === gameNumber),
    );
    if (conflict) {
      return {
        error: conflict.match_id === matchId
          ? `This replay was already uploaded as game ${conflict.game_number} of this series.`
          : "This replay has already been uploaded for another match.",
      };
    }
  }

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_team_id !== teamId && match.away_team_id !== teamId)
    return { error: "Your team is not in this match" };
  if (!match.home_team_id || !match.away_team_id)
    return { error: "Match is missing team assignments" };

  // Freeze the roster/eligibility snapshot on first replay for this match.
  // Best-effort: a snapshot failure shouldn't block a player's upload, but it
  // does mean the Step 6 resolver won't have anything to certify against.
  const snapshotResult = await ensureMatchIdentitySnapshot(matchId);
  if (!snapshotResult.ok) console.error(`Failed to create identity snapshot for match ${matchId}: ${snapshotResult.error}`);

  // Fetch both rosters once; resolve tracker names for all players in parallel.
  const { data: roster } = await supabaseAdmin
    .from("players")
    .select("id, username, display_name, tracker_url, team_id")
    .in("team_id", [match.home_team_id, match.away_team_id])
    .eq("status", "approved");

  const resolved = await Promise.all(
    (roster ?? []).map(async (p) => {
      const trackerName = p.tracker_url ? await resolveTrackerName(p.tracker_url) : null;
      return { ...p, trackerName };
    }),
  );

  // tracker name → player id (for stat writing)
  const nameToId = new Map<string, string>();
  // home team tracker names (for home/away detection)
  const homeTrackerNames = new Set<string>();

  // Pass 1: tracker names (highest priority).
  for (const p of resolved) {
    if (p.trackerName) {
      const norm = normalizeName(p.trackerName);
      nameToId.set(norm, p.id);
      if (p.team_id === match.home_team_id) homeTrackerNames.add(norm);
    }
  }
  // Pass 2: username and display_name fallbacks (only if tracker didn't already match).
  for (const p of resolved) {
    for (const name of [p.username, p.display_name as string | null | undefined]) {
      if (!name) continue;
      const norm = normalizeName(name);
      if (nameToId.has(norm)) continue;
      nameToId.set(norm, p.id);
      if (p.team_id === match.home_team_id) homeTrackerNames.add(norm);
    }
  }

  // Apply approved substitutions: ADD each sub candidate's tracker alongside the
  // original roster (don't remove the player they replace). The rulebook allows a
  // sub to be swapped in between games of a series, so different games can field
  // either the original player or the sub — accepting all of them (the 3 rostered
  // players + the sub) lets every game's lineup match and resolve to the right id.
  const { data: approvedSubs } = await supabaseAdmin
    .from("sub_requests")
    .select("player_out_id, sub_player_ids, sub_player_id")
    .eq("match_id", matchId)
    .eq("status", "approved");

  for (const subReq of (approvedSubs ?? [])) {
    const playerOut = (resolved ?? []).find(
      (p: { id: string }) => p.id === subReq.player_out_id,
    ) as { id: string; trackerName: string | null; team_id: string } | undefined;
    if (!playerOut) continue;

    const candidateIds: string[] =
      (subReq.sub_player_ids as string[] | null) ??
      (subReq.sub_player_id ? [subReq.sub_player_id] : []);
    if (candidateIds.length === 0) continue;

    const isHomeTeam = playerOut.team_id === match.home_team_id;

    // Add each sub candidate's tracker alongside the original roster.
    const { data: candidates } = await supabaseAdmin
      .from("players")
      .select("id, username, tracker_url")
      .in("id", candidateIds)
      .eq("status", "approved");

    for (const c of (candidates ?? []) as { id: string; username: string; tracker_url: string | null }[]) {
      // A tracker name we can't get is not a failure in itself: this loop runs
      // for every approved sub, including ones who never ended up playing, and a
      // sub who did play may still resolve below by verified platform ID — the
      // stronger signal, since that ID survives renames. Leave the unmatched
      // check as the only thing that can reject a replay.
      if (!c.tracker_url) continue;
      const trackerName = await resolveTrackerName(c.tracker_url);
      if (!trackerName) continue;
      nameToId.set(normalizeName(trackerName), c.id);
      if (isHomeTeam) homeTrackerNames.add(normalizeName(trackerName));
    }
  }

  // Claimed accounts win. A verified platform ID is tied to the account itself
  // and survives a rename; a tracker name is a string scraped at registration
  // that doesn't. So this runs over the whole lobby, not just the players the
  // name passes missed, and overwrites a name match that disagrees with it.
  const rescues = await resolvePlatformIdMatches(matchId, activePlayers);
  for (const p of activePlayers) {
    const key = normalizeName(p.name);
    const rescue = rescues.get(key);
    if (!rescue) continue;
    nameToId.set(key, rescue.playerId);
    if (rescue.team === "home") homeTrackerNames.add(key);
    else if (rescue.team === "away") homeTrackerNames.delete(key);
  }

  // An unrecognised player no longer rejects the replay — the series carries
  // the warning instead, and on strict an admin resolves it after both teams
  // agree the score. Their scoreboard line is kept with a null player_id so
  // the admin has something to map.
  const unmatchedNames = activePlayers
    .filter(p => !nameToId.has(normalizeName(p.name)))
    .map(p => p.name);

  // Whichever replay team has more home-tracker-name matches is the home team.
  const team0Hits = activePlayers
    .filter(p => p.team === 0 && homeTrackerNames.has(normalizeName(p.name))).length;
  const team1Hits = activePlayers
    .filter(p => p.team === 1 && homeTrackerNames.has(normalizeName(p.name))).length;

  // With no home-side hit on either team there is nothing to read the sides
  // off, and team0Hits >= team1Hits would silently call it blue. A replay
  // nobody in it belongs to is the wrong replay, not a bad one.
  if (team0Hits === 0 && team1Hits === 0)
    return { error: "Bad replay — none of these players are on either team in this match." };

  const blueIsHome = team0Hits >= team1Hits;

  const homeTeamWon = blueIsHome
    ? replayData.team0Score > replayData.team1Score
    : replayData.team1Score > replayData.team0Score;

  // Each replay player must resolve to a distinct registered player.
  const resolvedIds = activePlayers
    .map((p) => nameToId.get(normalizeName(p.name)))
    .filter((id): id is string => !!id);
  if (new Set(resolvedIds).size !== resolvedIds.length)
    return { error: "Two players in this replay map to the same person — each must map to a different player." };

  // If an admin forced a tracker update for this event, the players in this
  // replay must have re-verified their tracker before it can be submitted.
  const { data: flaggedInReplay } = await supabaseAdmin
    .from("players")
    .select("username, display_name")
    .in("id", resolvedIds)
    .eq("must_update_tracker", true);
  if ((flaggedInReplay ?? []).length) {
    const names = (flaggedInReplay ?? []).map((p) => p.display_name ?? p.username).join(", ");
    return {
      error: `These players must re-verify their tracker before this replay can be submitted: ${names}.`,
    };
  }

  const stats: AnalyzedGameStat[] = activePlayers.map((p) => ({
    player_id: nameToId.get(normalizeName(p.name)) ?? null,
    replay_name: p.name,
    goals: p.goals,
    assists: p.assists,
    saves: p.saves,
    shots: p.shots,
    score: p.score,
    demos: p.demos,
    demoed: p.demoed,
  }));

  return { homeTeamWon, replayId: replayData.replayId, stats, unmatchedNames, activePlayers };
}

// The write half: the certification row, the discrepancy rows beneath it, and
// the raw file for a game that failed. Separate from the analysis so a caller
// that validates the whole series first can hold this back until it knows the
// series is good.
export async function persistGameAnalysis(args: {
  matchId: string;
  gameNumber: number;
  bytes: Buffer;
  analysis: GameAnalysis;
}): Promise<void> {
  const { matchId, gameNumber, bytes, analysis } = args;

  const certResult = await evaluateAndPersistGameCertification({
    matchId,
    gameNumber,
    replayId: analysis.replayId,
    activePlayers: analysis.activePlayers,
    stats: analysis.stats,
    homeTeamWon: analysis.homeTeamWon,
    unmatchedNames: analysis.unmatchedNames,
  });

  // Only keep the raw file for games that failed certification, so an admin
  // can inspect the original replay on the discrepancy card — certified games
  // are the common case and storing all of them would burn through the
  // Supabase Storage free-tier cap for no admin-facing benefit.
  if (!certResult.certified && analysis.replayId) {
    const filePath = `${matchId}/${analysis.replayId}.replay`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("match-replays")
      .upload(filePath, bytes, { contentType: "application/octet-stream", upsert: true });
    if (!uploadError) {
      await supabaseAdmin
        .from("replay_identity_certifications")
        .update({ replay_file_path: filePath })
        .eq("replay_id", analysis.replayId);
    }
  }
}
