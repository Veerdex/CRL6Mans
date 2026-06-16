"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

export async function getLeaderboard(): Promise<{ username: string; display_name: string | null; score: number }[]> {
  const { data } = await supabaseAdmin
    .from("game_scores")
    .select("discord_id, username, score")
    .order("score", { ascending: false })
    .limit(10);
  if (!data?.length) return [];
  const discordIds = data.map((r: { discord_id: string }) => r.discord_id);
  const { data: players } = await supabaseAdmin
    .from("players")
    .select("discord_id, display_name")
    .in("discord_id", discordIds);
  const displayNameById = new Map((players ?? []).map((p: { discord_id: string; display_name: string | null }) => [p.discord_id, p.display_name]));
  return data.map((r: { discord_id: string; username: string; score: number }) => ({
    username: r.username,
    display_name: displayNameById.get(r.discord_id) ?? null,
    score: r.score,
  }));
}

export async function submitScore(
  score: number
): Promise<{ error?: string; newBest?: boolean; leaderboard?: { username: string; display_name: string | null; score: number }[] }> {
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

  const leaderboard = await getLeaderboard();
  return { leaderboard, newBest: isNewBest };
}
