import "server-only";
import { supabaseAdmin } from "./supabase";

export type PlayerStatus = "unregistered" | "pending" | "approved" | "rejected" | "banned";

export type Player = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
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

export async function getPlayerInfo(discordId: string): Promise<{
  status: PlayerStatus;
  teamId: string | null;
  displayName: string | null;
}> {
  const { data } = await supabaseAdmin
    .from("players")
    .select("status, team_id, display_name")
    .eq("discord_id", discordId)
    .single();
  return {
    status: (data?.status as PlayerStatus) ?? "unregistered",
    teamId: data?.team_id ?? null,
    displayName: (data?.display_name as string | null) ?? null,
  };
}

export async function getApprovedPlayers(): Promise<Player[]> {
  const { data } = await supabaseAdmin
    .from("players")
    .select("*")
    .eq("status", "approved");

  return (data ?? []).sort((a, b) => {
    const aRv = (Number(a.peak_2v2) + Number(a.current_2v2)) * 0.3 + (Number(a.peak_3v3) + Number(a.current_3v3)) * 0.2;
    const bRv = (Number(b.peak_2v2) + Number(b.current_2v2)) * 0.3 + (Number(b.peak_3v3) + Number(b.current_3v3)) * 0.2;
    return bRv - aRv;
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

export type StaffRole = "moderator" | "director" | "ceo";

export async function getStaffRole(discordId: string): Promise<StaffRole | null> {
  const { data } = await supabaseAdmin
    .from("staff_roles")
    .select("role")
    .eq("discord_id", discordId)
    .single();
  return (data?.role as StaffRole) ?? null;
}

export async function isModerator(discordId: string): Promise<boolean> {
  const role = await getStaffRole(discordId);
  return role !== null;
}

export async function isDirector(discordId: string): Promise<boolean> {
  const role = await getStaffRole(discordId);
  return role === "director" || role === "ceo";
}

export async function isCEO(discordId: string): Promise<boolean> {
  const role = await getStaffRole(discordId);
  return role === "ceo";
}

export { RL_RANKS } from "./ranks";
