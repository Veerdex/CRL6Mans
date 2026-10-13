"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
// The four series cores live in discord-bot.ts alongside finalizeAcceptedSeries:
// this file already depends on that module, so putting them anywhere else would
// make the dependency circular.
import {
  processExpiredScoreConfirmations,
  submitSeriesResultCore,
  confirmSeriesResultCore,
  cancelSeriesSubmissionCore,
  disputeSeriesResultCore,
} from "@/app/lib/discord-bot";
import { MAX_REPLAY_BYTES, MAX_REPLAY_LABEL } from "@/app/lib/upload-limits";
import { analyzeGameReplay, persistGameAnalysis, checkInGate } from "@/app/lib/replay-analysis";
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

// Any player on either team submits a claimed series result.
// Does NOT finalise the match — writes to pending fields only.
// The opposing team must confirm before admin can accept it.
export async function submitSeriesResult(
  matchId: string,
  homeWins: number,
  awayWins: number,
  games: SubmittedGame[] = [],
): Promise<{ error?: string }> {
  const session = await getSessionOrLogin();

  const result = await submitSeriesResultCore({
    matchId,
    actorDiscordId: session.userId,
    homeWins,
    awayWins,
    games,
  });
  if (result.error) return { error: result.error };

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
