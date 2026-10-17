"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { FLAPPY_GAME, FLAPPY_SEED, accountsFor } from "@/app/lib/game-scores";

// Everything in this file is Flappy Bird's. `game_scores` holds Send It's rows too, keyed
// per daily seed, so every query here pins game and seed — without it the Flappy board
// would list Send It distances, and `.maybeSingle()` on a player with rows in both games
// would error rather than reading their score.

export type LeaderboardRow = {
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  score: number;
  rank: number;
};
export type Leaderboard = { top: LeaderboardRow[]; self: LeaderboardRow | null };

const TOP_SCORES = 10;

export async function getLeaderboard(viewerDiscordId?: string): Promise<Leaderboard> {
  const { data } = await supabaseAdmin
    .from("game_scores")
    .select("discord_id, username, score")
    .eq("game", FLAPPY_GAME)
    .order("score", { ascending: false });
  if (!data?.length) return { top: [], self: null };

  const accountById = await accountsFor(data.map((r: { discord_id: string }) => r.discord_id));
  const ranked = data.map((r: { discord_id: string; username: string; score: number }, i: number) => ({
    discord_id: r.discord_id,
    username: accountById.get(r.discord_id)?.username ?? r.username,
    display_name: accountById.get(r.discord_id)?.display_name ?? null,
    avatar: accountById.get(r.discord_id)?.avatar ?? null,
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
    .eq("game", FLAPPY_GAME)
    .eq("seed", FLAPPY_SEED)
    .maybeSingle();

  const isNewBest = !existing || score > (existing.score ?? 0);

  if (isNewBest) {
    const { error } = await supabaseAdmin.from("game_scores").upsert(
      {
        discord_id: session.userId,
        username: session.username ?? "Unknown",
        game: FLAPPY_GAME,
        seed: FLAPPY_SEED,
        score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "discord_id,game,seed" }
    );
    if (error) return { error: error.message };
  }

  const leaderboard = await getLeaderboard(session.userId);
  return { leaderboard, newBest: isNewBest };
}

export type GameScoreRow = { discord_id: string; username: string; display_name: string | null; score: number; updated_at: string };

export async function getAllGameScores(): Promise<GameScoreRow[]> {
  // Returns empty rather than redirecting — the admin page awaits this
  // unconditionally, so a redirect would bounce moderators off the whole page
  // instead of just hiding the Director-only leaderboard.
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) return [];

  const { data } = await supabaseAdmin
    .from("game_scores")
    .select("discord_id, username, score, updated_at")
    .eq("game", FLAPPY_GAME)
    .order("score", { ascending: false });
  if (!data?.length) return [];
  const accountById = await accountsFor(data.map((r: { discord_id: string }) => r.discord_id));
  return data.map((r: { discord_id: string; username: string; score: number; updated_at: string }) => ({
    discord_id: r.discord_id,
    username: accountById.get(r.discord_id)?.username ?? r.username,
    display_name: accountById.get(r.discord_id)?.display_name ?? null,
    score: r.score,
    updated_at: r.updated_at,
  }));
}

export async function deleteGameScore(discordId: string) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");

  // Scoped to Flappy, since that is the board this clears a row from. Without it a Director
  // wiping one Flappy score would take every Send It distance the player had ever posted.
  const { error } = await supabaseAdmin
    .from("game_scores")
    .delete()
    .eq("discord_id", discordId)
    .eq("game", FLAPPY_GAME);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/game");
  return { ok: true };
}
