"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { notifyMatchChannel } from "@/app/lib/match-notifications";
import { getGuildRoles } from "@/app/lib/discord-api";
import { teamPing, seriesSubmittedPost } from "@/app/lib/match-embeds";
// confirmSeriesResultCore and cancelSeriesSubmissionCore live in discord-bot.ts
// alongside finalizeAcceptedSeries: this file already depends on that module, so
// putting them anywhere else would make the dependency circular.
import {
  getBestOfForMatch,
  validateSeriesScore,
  processExpiredScoreConfirmations,
  confirmSeriesResultCore,
  cancelSeriesSubmissionCore,
  disputeSeriesResultCore,
  clearScoreDispute,
  isScoreDisputed,
} from "@/app/lib/discord-bot";
import { MAX_REPLAY_BYTES, MAX_REPLAY_LABEL } from "@/app/lib/upload-limits";
import { analyzeGameReplay, persistGameAnalysis, checkInGate } from "@/app/lib/replay-analysis";
import { resolveSubmittedGames } from "@/app/lib/replay-identity-certification";
import { getReplayAnalysisMode } from "@/app/lib/replay-analysis-mode";
import { isStatsTrackingEnabled } from "@/app/lib/career-stats";
import type { AnalyzedGameStat, SubmittedGame } from "@/app/dashboard/admin/match-actions";

// For the actions that hand off to a core in discord-bot.ts: the core does its
// own team lookup from the Discord ID, so all this needs is who is calling.
async function getSessionOrLogin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");
  return session;
}

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
    .select("id, home_team_id, away_team_id, home_score, score_confirmed, result_reported_at, checkin_deadline, home_checked_in, away_checked_in")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_team_id !== player.team_id && match.away_team_id !== player.team_id)
    return { error: "Your team is not in this match" };
  if (match.home_score !== null) return { error: "This match already has a recorded result" };
  if (match.score_confirmed) return { error: "The result has already been confirmed — contact an admin to change it" };
  if (await isScoreDisputed(matchId))
    return { error: "This match is disputed — staff will record the result" };
  const checkIn = checkInGate(match);
  if (checkIn) return { error: checkIn };

  if (!Number.isInteger(homeWins) || !Number.isInteger(awayWins) || homeWins < 0 || awayWins < 0)
    return { error: "Scores must be non-negative whole numbers." };
  const bestOf = await getBestOfForMatch(matchId);
  const boError = validateSeriesScore(homeWins, awayWins, bestOf);
  if (boError) return { error: boError };

  // A stats-disabled event reports the series score only. Dropping the games
  // here (before the identity gate) means a stale client that still holds
  // uploaded replays submits a plain score instead of failing certification.
  if (!(await isStatsTrackingEnabled())) games = [];

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

  // Swaps in server-persisted, resolver-checked stats. Doesn't block: the
  // loose/strict mode decides what happens to a series with unmatched players,
  // and it decides after the opponent has accepted.
  const gate = await resolveSubmittedGames(matchId, games);
  games = gate.games;

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      pending_home_score:         homeWins,
      pending_away_score:         awayWins,
      score_submitted_by_team_id: player.team_id,
      score_confirmed:            false,
      score_submitted_at:         new Date().toISOString(),
      // One-way betting latch — a retraction clears everything else on this row,
      // but the score is already public in the match channel by then.
      result_reported_at:         match.result_reported_at ?? new Date().toISOString(),
    })
    .eq("id", matchId);

  if (error) return { error: error.message };

  // A resubmission supersedes any earlier rejection: the new claim gets its own
  // confirm/reject round, so the old one must not leave a Dispute button behind.
  await clearScoreDispute(matchId);

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
        demos: s.demos,
        demoed: s.demoed,
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
      const iAmHome = player.team_id === match.home_team_id;
      // Read off the games actually being submitted rather than through
      // getUnmatchedByGame, which is keyed on the match and would also pick up
      // rows left by a retracted attempt. A null player_id is the same
      // predicate analyzeGameReplay used, and it respects an admin who has
      // since mapped one of those names by hand.
      const unmatchedNames = games.flatMap((g) =>
        g.stats.filter((s) => !s.player_id).map((s) => s.replay_name),
      );
      await notifyMatchChannel(matchId, seriesSubmittedPost({
        teamName: myTeam.name,
        oppPing: teamPing(otherTeam.name, await getGuildRoles()),
        homeName: iAmHome ? myTeam.name : otherTeam.name,
        awayName: iAmHome ? otherTeam.name : myTeam.name,
        homeWins,
        awayWins,
        unmatchedNames,
        replayAnalysisMode: unmatchedNames.length ? await getReplayAnalysisMode() : undefined,
      }));
    }
  } catch { /* best-effort */ }

  // No staff push here. A submission is the routine case: the opponent confirms
  // it, or processExpiredScoreConfirmations auto-finalises it in 5-15 minutes, and
  // either way staff have nothing to do. Pinging them on every submission buried
  // the cases that do need them. Staff are notified when a match actually stalls:
  // finalizeAcceptedSeries pushes "Replay Review Required" when strict mode finds
  // unrecognised players. The submission is still visible in the admin panel's
  // pending list the whole time.

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return {};
}

// Opposing captain confirms the submitted result.
// On loose, or on strict with every replay player recognised, this finalises
// the match outright. On strict with unmatched players it hands the match to
// an admin instead — see finalizeAcceptedSeries.
export async function confirmSeriesResult(
  matchId: string
): Promise<{ error?: string }> {
  const session = await getSessionOrLogin();

  const result = await confirmSeriesResultCore({ matchId, actorDiscordId: session.userId });
  if (result.error) return { error: result.error };

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return {};
}

// The submitting team stands by a score the opponent rejected, which hands the
// match to staff. This is the only reporting action that notifies them — see
// disputeSeriesResultCore for why it takes two rounds to get here.
export async function disputeSeriesResult(
  matchId: string
): Promise<{ error?: string }> {
  const session = await getSessionOrLogin();

  const result = await disputeSeriesResultCore({ matchId, actorDiscordId: session.userId });
  if (result.error) return { error: result.error };

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
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
): Promise<{
  homeTeamWon?: boolean;
  replayId?: string | null;
  stats?: AnalyzedGameStat[];
  unmatchedNames?: string[];
  error?: string;
}> {
  const player = await getTeamMember();
  if (!player?.team_id) return { error: "Not on a team" };

  if (!(await isStatsTrackingEnabled()))
    return { error: "This tournament doesn't track stats — report the series score instead." };

  const { data: checkInRow } = await supabaseAdmin
    .from("matches")
    .select("checkin_deadline, home_checked_in, away_checked_in")
    .eq("id", matchId)
    .maybeSingle();
  if (checkInRow) {
    const checkIn = checkInGate(checkInRow);
    if (checkIn) return { error: checkIn };
  }

  // The File checks stay here rather than moving into replay-analysis.ts: the
  // size cap is Vercel's request-body limit, which only applies to a body that
  // reaches this function. A Discord attachment is fetched outbound from
  // cdn.discordapp.com and never passes through it, so /report is bounded by
  // Discord's own attachment ceiling instead.
  const file = formData.get("replay") as File | null;
  if (!file) return { error: "No file provided" };
  if (!file.name.toLowerCase().endsWith(".replay"))
    return { error: "File must be a .replay file" };
  // A backstop; Vercel 413s the request before this runs. See upload-limits.ts.
  if (file.size > MAX_REPLAY_BYTES)
    return { error: `File too large (max ${MAX_REPLAY_LABEL})` };

  const bytes = Buffer.from(await file.arrayBuffer());
  const analysis = await analyzeGameReplay({
    teamId: player.team_id,
    matchId,
    gameNumber,
    bytes,
  });
  if ("error" in analysis) return { error: analysis.error };

  // One game at a time, persisted as it lands — the panel analyses each slot on
  // upload and submits the series separately, so there is no later check that
  // could reject this game and strand its certification row. /report holds the
  // whole series back until it has validated all of it, then persists.
  await persistGameAnalysis({ matchId, gameNumber, bytes, analysis });

  return {
    homeTeamWon: analysis.homeTeamWon,
    replayId: analysis.replayId,
    stats: analysis.stats,
    unmatchedNames: analysis.unmatchedNames,
  };
}

// Either team can retract or reject a pending submission. Clears all pending
// fields so both sides can start fresh — and records the claim it threw out, so
// the submitting team has something to dispute if it stands by its score.
export async function cancelSeriesSubmission(
  matchId: string
): Promise<{ error?: string }> {
  const session = await getSessionOrLogin();

  const result = await cancelSeriesSubmissionCore({ matchId, actorDiscordId: session.userId });
  if (result.error) return { error: result.error };

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return {};
}
