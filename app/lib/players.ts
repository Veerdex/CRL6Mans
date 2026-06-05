import "server-only";
import { supabaseAdmin } from "./supabase";

export type PlayerStatus = "unregistered" | "pending" | "approved" | "rejected";

export type Player = {
  id: string;
  discord_id: string;
  username: string;
  avatar: string | null;
  status: PlayerStatus;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  tracker_url: string;
  college_image_url: string;
  draft_entered: boolean;
  created_at: string;
  team_id: string | null;
};

export async function getPlayerStatus(discordId: string): Promise<PlayerStatus> {
  const { data } = await supabaseAdmin
    .from("players")
    .select("status")
    .eq("discord_id", discordId)
    .single();

  if (!data) return "unregistered";
  return data.status as PlayerStatus;
}

export async function getPlayerInfo(
  discordId: string
): Promise<{ status: PlayerStatus; teamId: string | null }> {
  const { data } = await supabaseAdmin
    .from("players")
    .select("status, team_id")
    .eq("discord_id", discordId)
    .single();
  return {
    status: (data?.status as PlayerStatus) ?? "unregistered",
    teamId: data?.team_id ?? null,
  };
}

export async function getApprovedPlayers(): Promise<Player[]> {
  const { data } = await supabaseAdmin
    .from("players")
    .select("*")
    .eq("status", "approved");

  return (data ?? []).sort((a, b) => {
    const aMax = Math.max(Number(a.peak_2v2) || 0, Number(a.peak_3v3) || 0);
    const bMax = Math.max(Number(b.peak_2v2) || 0, Number(b.peak_3v3) || 0);
    return bMax - aMax;
  });
}

export async function getAllPendingPlayers(): Promise<Player[]> {
  const { data } = await supabaseAdmin
    .from("players")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return data ?? [];
}

export async function updatePlayerStatus(
  playerId: string,
  status: "approved" | "rejected"
): Promise<{ discordId: string | null }> {
  const { data } = await supabaseAdmin
    .from("players")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", playerId)
    .select("discord_id")
    .single();
  return { discordId: data?.discord_id ?? null };
}

export function isAdmin(discordId: string): boolean {
  const adminIds = process.env.ADMIN_DISCORD_IDS?.split(",").map((id) => id.trim()) ?? [];
  return adminIds.includes(discordId);
}

export { RL_RANKS } from "./ranks";
