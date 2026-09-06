"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified, isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { finalizeMatchAndCloseChannel } from "@/app/lib/discord-bot";
import { notifyMatchChannel } from "@/app/lib/match-notifications";
import { pushToTeam } from "@/app/lib/push";
import type { ReplayAnalysisMode } from "@/app/lib/replay-analysis-mode";
import type { AnalyzedGameStat } from "@/app/dashboard/admin/match-actions";

async function requireDirector() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
}

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
}

export async function setReplayAnalysisMode(
  mode: ReplayAnalysisMode,
): Promise<{ error?: string }> {
  await requireDirector();
  if (mode !== "loose" && mode !== "strict") return { error: "Unknown mode" };

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ replay_analysis_mode: mode })
    .not("id", "is", null);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return {};
}

// Fills in the players the replays couldn't identify, then finalises the match.
// `mappings` is replay player name -> player id, exactly the shape the aka
// overrides on the admin match reporter use.
export async function approveReplayReview(
  matchId: string,
  mappings: Record<string, string>,
): Promise<{ error?: string }> {
  await requireAdmin();

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, pending_home_score, pending_away_score, home_score, replay_review_status")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_score !== null) return { error: "This match is already finalised" };
  if (match.replay_review_status !== "pending_admin")
    return { error: "This match is not awaiting replay review" };
  if (match.pending_home_score === null) return { error: "No submitted result to finalise" };

  const { data: certRows } = await supabaseAdmin
    .from("replay_identity_certifications")
    .select("replay_id, game_number, stats_json, unmatched_names")
    .eq("match_id", matchId);

  // Every unmatched name must be accounted for — a half-mapped series would
  // finalise with the same silent gaps that sent it here.
  const stillUnmatched = (certRows ?? [])
    .flatMap((r) => (r.unmatched_names ?? []) as string[])
    .filter((name) => !mappings[name]);
  if (stillUnmatched.length)
    return { error: `Still unmapped: ${[...new Set(stillUnmatched)].join(", ")}` };

  for (const row of certRows ?? []) {
    const names = (row.unmatched_names ?? []) as string[];
    if (!names.length) continue;

    const stats = ((row.stats_json ?? []) as AnalyzedGameStat[]).map((s) =>
      s.player_id ? s : { ...s, player_id: mappings[s.replay_name] ?? null },
    );

    await supabaseAdmin
      .from("replay_identity_certifications")
      .update({ stats_json: stats, unmatched_names: [] })
      .eq("replay_id", row.replay_id);

    for (const name of names) {
      await supabaseAdmin
        .from("player_game_stats")
        .update({ player_id: mappings[name] })
        .eq("match_id", matchId)
        .eq("game_number", row.game_number)
        .eq("replay_name", name);
    }
  }

  await supabaseAdmin
    .from("matches")
    .update({ replay_review_status: "none" })
    .eq("id", matchId);

  await finalizeMatchAndCloseChannel(
    matchId,
    match.pending_home_score as number,
    match.pending_away_score as number,
  );

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/season");
  return {};
}

// Sends the series back to the teams. Clears the pending result and the stats
// it wrote, so the next submission starts clean.
export async function rejectReplayReview(
  matchId: string,
  reason: string,
): Promise<{ error?: string }> {
  await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { error: "A reason is required — both teams are told what it says." };

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, replay_review_status")
    .eq("id", matchId)
    .single();

  if (!match) return { error: "Match not found" };
  if (match.home_score !== null) return { error: "This match is already finalised" };
  if (match.replay_review_status !== "pending_admin")
    return { error: "This match is not awaiting replay review" };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      pending_home_score:         null,
      pending_away_score:         null,
      score_submitted_by_team_id: null,
      score_confirmed:            false,
      score_submitted_at:         null,
      replay_review_status:       "rejected",
    })
    .eq("id", matchId);
  if (error) return { error: error.message };

  await supabaseAdmin.from("player_game_stats").delete().eq("match_id", matchId);

  for (const teamId of [match.home_team_id, match.away_team_id]) {
    if (!teamId) continue;
    pushToTeam(teamId as string, {
      title: "Replay submission rejected",
      body: trimmed,
      url: "/dashboard/my-team",
      tag: "replay-review",
    }).catch(() => {});
  }

  notifyMatchChannel(
    matchId,
    `❌ An admin rejected this series' replay submission.\n**Reason:** ${trimmed}\nPlease upload the correct replays and resubmit.`,
  ).catch(() => {});

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return {};
}
