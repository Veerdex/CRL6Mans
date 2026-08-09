"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { roleMention, notifyMatchChannel } from "@/app/lib/match-notifications";
import { pushToAdmins } from "@/app/lib/push";
import { execReportMatchResult, getBestOfForMatch, validateSeriesScore, processExpiredScoreConfirmations } from "@/app/lib/discord-bot";
import { deleteChannel } from "@/app/lib/discord-api";
import { parseReplay } from "@/app/lib/replay-parser";
import { resolveTrackerName, normalizeName } from "@/app/lib/tracker-name";
import { ensureMatchIdentitySnapshot } from "@/app/lib/match-identity-snapshot";
import { evaluateAndPersistGameCertification, resolveSubmittedGames, resolvePlatformIdMatches, hasBlockingIdentityDiscrepancy } from "@/app/lib/replay-identity-certification";
import type { AnalyzedGameStat, SubmittedGame } from "@/app/dashboard/admin/match-actions";

// Any approved player on a team can submit/confirm results — not just the captain.
// Subs are excluded because their team_id won't match the match's teams.
async function getTeamMember() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("discord_id", session.userId)
    .single();

  return player;
}

// Captain of either team submits a claimed series result.
// Does NOT finalise the match — writes to pending fields only.
// The opposing captain must confirm before admin can accept it.
export async function submitSeriesResult(
  matchId: string,
  homeWins: number,
  awayWins: number,
  games: SubmittedGame[] = [],
): Promise<{ error?: string }> {
  const player = await getTeamMember();
  if (!player?.team_id) return { error: "Not on a team" };

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, score_confirmed")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_team_id !== player.team_id && match.away_team_id !== player.team_id)
    return { error: "Your team is not in this match" };
  if (match.home_score !== null) return { error: "This match already has a recorded result" };
  if (match.score_confirmed) return { error: "The result has already been confirmed — contact an admin to change it" };

  if (!Number.isInteger(homeWins) || !Number.isInteger(awayWins) || homeWins < 0 || awayWins < 0)
    return { error: "Scores must be non-negative whole numbers." };
  const bestOf = await getBestOfForMatch(matchId);
  const boError = validateSeriesScore(homeWins, awayWins, bestOf);
  if (boError) return { error: boError };

  // Guard against a replay already committed to a different match.
  const replayIds = games.map((g) => g.replayId).filter((id): id is string => !!id);
  if (replayIds.length) {
    const { data: existing } = await supabaseAdmin
      .from("player_game_stats")
      .select("replay_id, match_id")
      .in("replay_id", replayIds);
    if ((existing ?? []).some((r) => r.match_id !== matchId))
      return { error: "One of these replays was already uploaded for another match." };
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
    return { error: gate.message };
  }
  games = gate.games;

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      pending_home_score:         homeWins,
      pending_away_score:         awayWins,
      score_submitted_by_team_id: player.team_id,
      score_confirmed:            false,
      score_submitted_at:         new Date().toISOString(),
    })
    .eq("id", matchId);

  if (error) return { error: error.message };

  // Best-effort — identity_status is a visibility column, not load-bearing for
  // submission, and must not fail the whole request if the migration adding it
  // hasn't been run against this DB yet. Supabase returns query errors in the
  // result rather than throwing, so this is deliberately fire-and-forget.
  try {
    await supabaseAdmin.from("matches").update({ identity_status: gate.identityStatus }).eq("id", matchId);
  } catch {
    // ignored — see comment above
  }

  // Persist replay stats now that the series is being submitted (replace any prior set).
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
      })),
    );
    if (rows.length) await supabaseAdmin.from("player_game_stats").insert(rows);
  } catch { /* best-effort */ }

  try {
    const otherTeamId = player.team_id === match.home_team_id ? match.away_team_id : match.home_team_id;
    const [{ data: myTeam }, { data: otherTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", player.team_id).single(),
      supabaseAdmin.from("teams").select("name").eq("id", otherTeamId).single(),
    ]);
    if (myTeam?.name && otherTeam?.name) {
      const mention = await roleMention(otherTeam.name);
      await notifyMatchChannel(
        matchId,
        `${mention} 📊 **${myTeam.name}** submitted the series result: **${homeWins}–${awayWins}**.\nHead to the website to confirm or dispute.`,
      );
    }
  } catch { /* best-effort */ }

  pushToAdmins({
    title: "Match Result Submitted",
    body: `A team submitted a series result (${homeWins}–${awayWins}) — pending confirmation.`,
    url: "/dashboard/admin",
    tag: "match-reporting",
  }, "match_reporting").catch(() => {});

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return {};
}

// Opposing captain confirms the submitted result.
// Auto-approves: finalises the match, advances the bracket, and deletes the Discord channel.
export async function confirmSeriesResult(
  matchId: string
): Promise<{ error?: string }> {
  const player = await getTeamMember();
  if (!player?.team_id) return { error: "Not on a team" };

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, pending_home_score, pending_away_score, score_submitted_by_team_id, home_score, discord_channel_id")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_team_id !== player.team_id && match.away_team_id !== player.team_id)
    return { error: "Your team is not in this match" };
  if (match.home_score !== null) return { error: "This match is already finalised" };
  if (match.pending_home_score === null) return { error: "No pending result to confirm" };
  if (match.score_submitted_by_team_id === player.team_id)
    return { error: "You cannot confirm your own submission — wait for the opposing captain" };

  if (await hasBlockingIdentityDiscrepancy(matchId))
    return { error: "This match has an open identity discrepancy and requires admin review before it can be confirmed." };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({ score_confirmed: true })
    .eq("id", matchId);

  if (error) return { error: error.message };

  // Auto-approve: finalize the match, update W/L, advance the bracket,
  // and create the next channel if both opponents are already known.
  try {
    await execReportMatchResult(matchId, match.pending_home_score!, match.pending_away_score!);
  } catch { /* best-effort — admin can still finalize manually */ }

  // Delete this match's Discord channel now that the result has been posted.
  if (match.discord_channel_id) {
    try {
      await deleteChannel(match.discord_channel_id);
      await supabaseAdmin.from("matches")
        .update({ discord_channel_id: null })
        .eq("id", matchId);
    } catch { /* best-effort */ }
  }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return {};
}

// Client-fired when a confirmation deadline passes while someone has the page open —
// auto-finalizes any series whose confirm window has elapsed (15 min for a standalone
// season, 5 min for a discrete tournament). Idempotent.
export async function processScoreConfirmationsNow(): Promise<{ ok: boolean }> {
  const player = await getTeamMember();
  if (!player) return { ok: false };
  await processExpiredScoreConfirmations().catch(() => {});
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return { ok: true };
}

// Parses a .replay file and determines which team won that individual game.
// Maps blue (team0) / orange (team1) to home/away by matching player names
// against the team rosters stored in the database.
// Parses + resolves a replay but does NOT write to the DB. Stats are returned to
// the client and only persisted when the captain submits the series result.
export async function uploadGameReplay(
  formData: FormData,
  matchId: string,
  gameNumber = 1,
): Promise<{ homeTeamWon?: boolean; replayId?: string | null; stats?: AnalyzedGameStat[]; error?: string }> {
  const player = await getTeamMember();
  if (!player?.team_id) return { error: "Not on a team" };

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

  // Every league game is a full 3v3 lobby. Reject replays that aren't 3-per-side
  // (someone left, a 2v2 was uploaded, etc.). Admin-side uploads bypass this.
  const PLAYERS_PER_TEAM = 3;
  const team0Count = activePlayers.filter((p) => p.team === 0).length;
  const team1Count = activePlayers.filter((p) => p.team === 1).length;
  if (team0Count !== PLAYERS_PER_TEAM || team1Count !== PLAYERS_PER_TEAM)
    return {
      error: `This replay is ${team0Count}v${team1Count} (${replayData.players.length} player${replayData.players.length === 1 ? "" : "s"}) — a valid game must be ${PLAYERS_PER_TEAM}v${PLAYERS_PER_TEAM} with ${PLAYERS_PER_TEAM * 2} players.`,
    };

  // Reject duplicates already committed to the DB (another match, or a prior
  // submission of this series). Same-session dupes are caught client-side.
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
  if (match.home_team_id !== player.team_id && match.away_team_id !== player.team_id)
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
      if (!c.tracker_url) {
        return {
          error: `Sub candidate ${c.username} has no tracker URL set — ask them to set it in Settings before uploading.`,
        };
      }
      const trackerName = await resolveTrackerName(c.tracker_url);
      if (!trackerName) {
        return { error: `Could not resolve tracker name for sub candidate ${c.username}.` };
      }
      nameToId.set(normalizeName(trackerName), c.id);
      if (isHomeTeam) homeTrackerNames.add(normalizeName(trackerName));
    }
  }

  // Reject the replay if any active player can't be matched to a known tracker name —
  // unless a verified platform ID rescues them (e.g. a player who renamed since
  // registering their tracker). See resolvePlatformIdMatches for scope.
  let unmatched = activePlayers.filter(
    p => !nameToId.has(normalizeName(p.name)),
  );
  if (unmatched.length > 0) {
    const rescues = await resolvePlatformIdMatches(matchId, activePlayers);
    for (const p of unmatched) {
      const rescue = rescues.get(normalizeName(p.name));
      if (!rescue) continue;
      nameToId.set(normalizeName(p.name), rescue.playerId);
      if (rescue.team === "home") homeTrackerNames.add(normalizeName(p.name));
    }
    unmatched = activePlayers.filter(p => !nameToId.has(normalizeName(p.name)));
  }
  if (unmatched.length > 0) {
    const names = unmatched.map(p => p.name).join(", ");
    return {
      error: `Bad replay — ${unmatched.length} player${unmatched.length > 1 ? "s" : ""} not recognised: ${names}`,
    };
  }

  // Whichever replay team has more home-tracker-name matches is the home team.
  const team0Hits = activePlayers
    .filter(p => p.team === 0 && homeTrackerNames.has(normalizeName(p.name))).length;
  const team1Hits = activePlayers
    .filter(p => p.team === 1 && homeTrackerNames.has(normalizeName(p.name))).length;
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
  }));

  // Identity resolution + certification persistence (Steps 6 + 7). Never
  // blocks this analyze-time call — the hard block, when enabled, happens at
  // series submission via resolveSubmittedGames.
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

// Either captain can retract / dispute a pending submission.
// Clears all pending fields so both sides can start fresh.
export async function cancelSeriesSubmission(
  matchId: string
): Promise<{ error?: string }> {
  const player = await getTeamMember();
  if (!player?.team_id) return { error: "Not on a team" };

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_team_id !== player.team_id && match.away_team_id !== player.team_id)
    return { error: "Your team is not in this match" };
  if (match.home_score !== null) return { error: "This match is already finalised" };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      pending_home_score:         null,
      pending_away_score:         null,
      score_submitted_by_team_id: null,
      score_confirmed:            false,
      score_submitted_at:         null,
    })
    .eq("id", matchId);

  if (error) return { error: error.message };

  try {
    const otherTeamId = player.team_id === match.home_team_id ? match.away_team_id : match.home_team_id;
    const [{ data: myTeam }, { data: otherTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", player.team_id).single(),
      supabaseAdmin.from("teams").select("name").eq("id", otherTeamId).single(),
    ]);
    if (myTeam?.name && otherTeam?.name) {
      const mention = await roleMention(otherTeam.name);
      await notifyMatchChannel(
        matchId,
        `${mention} ↩️ **${myTeam.name}** disputed the submitted result. Please resubmit when ready.`,
      );
    }
  } catch { /* best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return {};
}
