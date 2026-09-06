"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { execReportMatchResult, getBestOfForMatch, validateSeriesScore } from "@/app/lib/discord-bot";
import { supabaseAdmin } from "@/app/lib/supabase";
import { parseReplay } from "@/app/lib/replay-parser";
import { resolveTrackerName, normalizeName } from "@/app/lib/tracker-name";
import { ensureMatchIdentitySnapshot } from "@/app/lib/match-identity-snapshot";
import { evaluateAndPersistGameCertification, resolveSubmittedGames, resolvePlatformIdMatches } from "@/app/lib/replay-identity-certification";
import { pushToAdmins } from "@/app/lib/push";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
}

export async function dqTeamFromMatch(
  matchId: string,
  dqTeamId: string
): Promise<{ ok: boolean; message: string }> {
  await verifyAdmin();

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, status")
    .eq("id", matchId)
    .single();
  if (!match) return { ok: false, message: "Match not found." };
  if (match.status === "completed") return { ok: false, message: "Match already completed." };
  if (match.home_team_id !== dqTeamId && match.away_team_id !== dqTeamId)
    return { ok: false, message: "Team is not in this match." };

  const bestOf = await getBestOfForMatch(matchId);
  const winsNeeded = Math.ceil(bestOf / 2);

  const dqIsHome = match.home_team_id === dqTeamId;
  const homeScore = dqIsHome ? 0 : winsNeeded;
  const awayScore = dqIsHome ? winsNeeded : 0;

  const result = await execReportMatchResult(matchId, homeScore, awayScore, 0, /*forfeit*/ true, /*skipRatingUpdate*/ true);
  if (result.ok) {
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/season");
    revalidatePath("/dashboard/my-team");
  }
  return result;
}

export type AnalyzedGameStat = {
  player_id: string | null;
  replay_name: string;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
  demos: number;
  demoed: number;
};

// Parses + resolves a replay but does NOT write to the DB. The resolved stats are
// returned to the client and only persisted when the match is submitted.
export async function adminAnalyzeGameReplay(
  formData: FormData,
  matchId: string,
  gameNumber: number,
  akaNames: Record<string, string>,
): Promise<{ homeTeamWon?: boolean; replayId?: string | null; stats?: AnalyzedGameStat[]; unmatched?: string[]; error?: string }> {
  await verifyAdmin();

  const file = formData.get("replay") as File | null;
  if (!file) return { error: "No file provided" };
  if (!file.name.toLowerCase().endsWith(".replay"))
    return { error: "File must be a .replay file" };
  if (file.size > 5 * 1024 * 1024)
    return { error: "File too large (max 5 MB)" };

  let replayData;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    replayData = parseReplay(buf);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse replay" };
  }

  if (replayData.team0Score === replayData.team1Score)
    return { error: "Replay shows a tied game — please check the file" };

  // Casters appear in the replay with 0 score — exclude them before any validation.
  const activePlayers = replayData.players.filter((p) => p.score > 0);

  // Reject duplicate uploads of the same replay (anywhere except this exact slot,
  // which is allowed so admins can re-upload a game with corrected aka mappings).
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
          ? `This replay was already uploaded as game ${conflict.game_number} of this match.`
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
  if (!match.home_team_id || !match.away_team_id)
    return { error: "Match is missing team assignments" };

  // Freeze the roster/eligibility snapshot on first replay for this match.
  // Best-effort: a snapshot failure shouldn't block the analysis, but it
  // does mean the Step 6 resolver won't have anything to certify against.
  const snapshotResult = await ensureMatchIdentitySnapshot(matchId);
  if (!snapshotResult.ok) console.error(`Failed to create identity snapshot for match ${matchId}: ${snapshotResult.error}`);

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

  const nameToId = new Map<string, string>();
  const homeTrackerNames = new Set<string>();
  const playerTeamById = new Map<string, string>();

  // Pass 1: tracker names (highest priority).
  for (const p of resolved) {
    playerTeamById.set(p.id, p.team_id);
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

  // Apply approved subs: add each candidate's tracker alongside the original
  // roster without removing the player they replace, so a series where the
  // original played some games and the sub played others resolves either way.
  // Kept identical to the captain upload in my-team/series-actions.ts.
  const { data: approvedSubs } = await supabaseAdmin
    .from("sub_requests")
    .select("player_out_id, sub_player_ids, sub_player_id")
    .eq("match_id", matchId)
    .eq("status", "approved");

  for (const subReq of approvedSubs ?? []) {
    const playerOut = resolved.find((p) => p.id === subReq.player_out_id);
    if (!playerOut) continue;
    const candidateIds: string[] =
      (subReq.sub_player_ids as string[] | null) ??
      (subReq.sub_player_id ? [subReq.sub_player_id] : []);
    if (!candidateIds.length) continue;

    const isHomeTeam = playerOut.team_id === match.home_team_id;

    const { data: candidates } = await supabaseAdmin
      .from("players")
      .select("id, username, tracker_url")
      .in("id", candidateIds)
      .eq("status", "approved");

    for (const c of (candidates ?? []) as { id: string; username: string; tracker_url: string | null }[]) {
      if (!c.tracker_url) continue;
      const trackerName = await resolveTrackerName(c.tracker_url);
      if (!trackerName) continue;
      const norm = normalizeName(trackerName);
      nameToId.set(norm, c.id);
      playerTeamById.set(c.id, playerOut.team_id);
      if (isHomeTeam) homeTrackerNames.add(norm);
    }
  }

  // Apply admin aka overrides (highest priority — lets admin fix wrong-account plays)
  for (const [replayName, playerId] of Object.entries(akaNames)) {
    if (!replayName || !playerId) continue;
    const norm = normalizeName(replayName);
    nameToId.set(norm, playerId);
    // Determine which team the override player is on
    const teamId =
      playerTeamById.get(playerId) ?? resolved.find((p) => p.id === playerId)?.team_id;
    if (teamId === match.home_team_id) homeTrackerNames.add(norm);
    else homeTrackerNames.delete(norm);
  }

  let unmatched = activePlayers.filter(
    (p) => !nameToId.has(normalizeName(p.name)),
  );
  if (unmatched.length > 0) {
    const rescues = await resolvePlatformIdMatches(matchId, activePlayers);
    for (const p of unmatched) {
      const rescue = rescues.get(normalizeName(p.name));
      if (!rescue) continue;
      nameToId.set(normalizeName(p.name), rescue.playerId);
      if (rescue.team === "home") homeTrackerNames.add(normalizeName(p.name));
    }
    unmatched = activePlayers.filter((p) => !nameToId.has(normalizeName(p.name)));
  }
  if (unmatched.length > 0) {
    return { unmatched: unmatched.map((p) => p.name) };
  }

  const team0Hits = activePlayers.filter(
    (p) => p.team === 0 && homeTrackerNames.has(normalizeName(p.name)),
  ).length;
  const team1Hits = activePlayers.filter(
    (p) => p.team === 1 && homeTrackerNames.has(normalizeName(p.name)),
  ).length;
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

  // Identity resolution + certification persistence (Steps 6 + 7). Never
  // blocks this analyze-time call — the hard block, when enabled, happens at
  // match submission via resolveSubmittedGames. An admin who sees a
  // mismatch here should fix it via akaNames and re-upload; re-analysis
  // supersedes the prior certification for the same replay_id.
  await evaluateAndPersistGameCertification({
    matchId,
    gameNumber,
    replayId: replayData.replayId,
    activePlayers,
    stats,
    homeTeamWon,
  });

  return { homeTeamWon, replayId: replayData.replayId, stats };
}

export type SubmittedGame = { gameNumber: number; replayId: string | null; stats: AnalyzedGameStat[] };

export async function reportMatchResult(
  matchId: string,
  homeScore: number,
  awayScore: number,
  games: SubmittedGame[] = [],
) {
  await verifyAdmin();
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) ||
      !Number.isInteger(homeScore) || !Number.isInteger(awayScore))
    return { ok: false, message: "Scores must be whole numbers." };
  if (homeScore < 0 || awayScore < 0)
    return { ok: false, message: "Scores cannot be negative." };
  const bestOf = await getBestOfForMatch(matchId);
  const boError = validateSeriesScore(homeScore, awayScore, bestOf);
  if (boError) return { ok: false, message: boError };

  // Guard against a replay already committed to a different match.
  const replayIds = games.map((g) => g.replayId).filter((id): id is string => !!id);
  if (replayIds.length) {
    const { data: existing } = await supabaseAdmin
      .from("player_game_stats")
      .select("replay_id, match_id")
      .in("replay_id", replayIds);
    if ((existing ?? []).some((r) => r.match_id !== matchId))
      return { ok: false, message: "One of these replays was already uploaded for another match." };
  }

  // Step 7 whole-match identity gate: swaps in server-persisted, resolver-checked
  // stats and — only once identity_enforcement_enabled is on — blocks submission
  // outright when any game failed platform-identity certification.
  const gate = await resolveSubmittedGames(matchId, games);
  if (!gate.ok) {
    await supabaseAdmin.from("matches").update({ identity_status: gate.identityStatus }).eq("id", matchId);
    pushToAdmins({
      title: "Identity Review Required",
      body: `A submitted match result needs admin review before it can be completed.`,
      url: "/dashboard/admin",
      tag: "identity-review",
    }).catch(() => {});
    return { ok: false, message: gate.message };
  }
  games = gate.games;

  // Compute goal differential from submitted replay stats when available.
  let goalDiff = 0;
  if (games.length > 0) {
    const allPlayerIds = [...new Set(
      games.flatMap((g) => g.stats.map((s) => s.player_id).filter((id): id is string => !!id))
    )];
    if (allPlayerIds.length > 0) {
      const [{ data: matchData }, { data: playerRows }] = await Promise.all([
        supabaseAdmin.from("matches").select("home_team_id, away_team_id").eq("id", matchId).single(),
        supabaseAdmin.from("players").select("id, team_id").in("id", allPlayerIds),
      ]);
      const teamOf = new Map((playerRows ?? []).map((p) => [p.id, p.team_id]));
      for (const game of games) {
        for (const stat of game.stats) {
          if (!stat.player_id) continue;
          const teamId = teamOf.get(stat.player_id);
          if (teamId === matchData?.home_team_id) goalDiff += stat.goals;
          else if (teamId === matchData?.away_team_id) goalDiff -= stat.goals;
        }
      }
    }
  }

  const result = await execReportMatchResult(matchId, homeScore, awayScore, goalDiff);
  if (!result.ok) return result;

  // Persist replay stats now that the match is submitted (replace any prior set).
  try {
    await supabaseAdmin.from("player_game_stats").delete().eq("match_id", matchId);
    const rows = games.flatMap((g) =>
      g.stats.map((s) => ({
        player_id: s.player_id,
        match_id: matchId,
        game_number: g.gameNumber,
        replay_id: g.replayId,
        replay_name: s.replay_name,
        goals: s.goals,
        assists: s.assists,
        saves: s.saves,
        shots: s.shots,
        score: s.score,
        demos: s.demos,
        demoed: s.demoed,
      })),
    );
    if (rows.length) await supabaseAdmin.from("player_game_stats").insert(rows);
  } catch { /* best-effort */ }

  await supabaseAdmin.from("matches").update({ identity_status: gate.identityStatus }).eq("id", matchId);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  revalidatePath("/dashboard/my-team");
  return result;
}
