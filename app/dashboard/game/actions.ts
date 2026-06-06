"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

export async function getLeaderboard(): Promise<{ username: string; score: number }[]> {
  const { data } = await supabaseAdmin
    .from("game_scores")
    .select("username, score")
    .order("score", { ascending: false })
    .limit(10);
  return data ?? [];
}

export async function submitScore(
  score: number
): Promise<{ error?: string; newBest?: boolean; leaderboard?: { username: string; score: number }[] }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  if (!Number.isInteger(score) || score < 0) return { error: "Invalid score." };

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
