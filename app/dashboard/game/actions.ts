"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

export type LeaderboardRow = { username: string; display_name: string | null; score: number; rank: number };
export type Leaderboard = { top: LeaderboardRow[]; self: LeaderboardRow | null };

const TOP_SCORES = 10;

// Display names come from accounts (Tier 1), which exists for every Discord
// login — reading them off `players` left anyone without a roster row (guests,
// unapproved players) showing their raw username.
async function displayNamesFor(discordIds: string[]): Promise<Map<string, string | null>> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, display_name")
    .in("discord_id", discordIds);
  return new Map((data ?? []).map((a: { discord_id: string; display_name: string | null }) => [a.discord_id, a.display_name]));
}

export async function getLeaderboard(viewerDiscordId?: string): Promise<Leaderboard> {
  const { data } = await supabaseAdmin
    .from("game_scores")
    .select("discord_id, username, score")
    .order("score", { ascending: false });
  if (!data?.length) return { top: [], self: null };

  const displayNameById = await displayNamesFor(data.map((r: { discord_id: string }) => r.discord_id));
  const ranked = data.map((r: { discord_id: string; username: string; score: number }, i: number) => ({
    username: r.username,
    display_name: displayNameById.get(r.discord_id) ?? null,
    score: r.score,
    rank: i + 1,
  }));

  // Someone outside the top 10 still needs to see their own best, or a score
  // that saved fine reads as one that was never recorded.
  const selfIndex = viewerDiscordId ? data.findIndex((r: { discord_id: string }) => r.discord_id === viewerDiscordId) : -1;
  return {
    top: ranked.slice(0, TOP_SCORES),
    self: selfIndex >= TOP_SCORES ? ranked[selfIndex] : null,
  };
}

export async function submitScore(
  score: number
): Promise<{ error?: string; newBest?: boolean; leaderboard?: Leaderboard }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  // The game is client-side, so scores can't be fully trusted; reject only
  // clearly impossible values to keep the leaderboard from being trivially spoofed.
  const MAX_PLAUSIBLE_SCORE = 10000;
  if (!Number.isInteger(score) || score < 0 || score > MAX_PLAUSIBLE_SCORE) {
    return { error: "Invalid score." };
  }

  const { data: existing } = await supabaseAdmin
    .from("game_scores")
    .select("score")
    .eq("discord_id", session.userId)
    .maybeSingle();

  const isNewBest = !existing || score > (existing.score ?? 0);

  if (isNewBest) {
    const { error } = await supabaseAdmin.from("game_scores").upsert(
      {
        discord_id: session.userId,
        username: session.username ?? "Unknown",
        score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "discord_id" }
    );
    if (error) return { error: error.message };
  }

  const leaderboard = await getLeaderboard(session.userId);
  return { leaderboard, newBest: isNewBest };
}

export type GameScoreRow = { discord_id: string; username: string; display_name: string | null; score: number; updated_at: string };

export async function getAllGameScores(): Promise<GameScoreRow[]> {
  const { data } = await supabaseAdmin
    .from("game_scores")
    .select("discord_id, username, score, updated_at")
    .order("score", { ascending: false });
  if (!data?.length) return [];
  const displayNameById = await displayNamesFor(data.map((r: { discord_id: string }) => r.discord_id));
  return data.map((r: { discord_id: string; username: string; score: number; updated_at: string }) => ({
    discord_id: r.discord_id,
    username: r.username,
    display_name: displayNameById.get(r.discord_id) ?? null,
    score: r.score,
    updated_at: r.updated_at,
  }));
}

export async function deleteGameScore(discordId: string) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");

  const { error } = await supabaseAdmin.from("game_scores").delete().eq("discord_id", discordId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/game");
  return { ok: true };
}
