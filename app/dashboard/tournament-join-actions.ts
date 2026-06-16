"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isGuildMember } from "@/app/lib/discord-api";
import { isTrackerStale } from "@/app/lib/tracker";
import { logAnalyticsEvent } from "@/app/lib/analytics";

async function currentPlayer() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return null;
  const { data } = await supabaseAdmin
    .from("players")
    .select("id, status, discord_id, kick_reason, peak_2v2, peak_3v3, tracker_confirmed_at")
    .eq("discord_id", session.userId)
    .single();
  return data ? { ...data, userId: session.userId } : null;
}

export async function joinTournament(tournamentId: string, confirmTrackerSame = false): Promise<{ error?: string; ok?: boolean; message?: string; inviteRequired?: boolean; trackerStale?: boolean }> {
  const player = await currentPlayer();
  if (!player) return { error: "You are not registered." };
  if (player.status !== "approved") return { error: "Your registration must be approved first." };
  if (player.kick_reason) return { error: "You are not eligible to join this tournament." };

  const inServer = await isGuildMember(player.userId);
  if (!inServer) return { inviteRequired: true };

  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("status, join_mode, signups_open, signups_closed, draft_open_at, draft_close_at, min_mmr_2v2, min_mmr_3v3")
    .eq("id", tournamentId)
    .single();
  if (!t) return { error: "Tournament not found." };
  if (t.join_mode !== "players") return { error: "This tournament uses team sign-ups." };
  if (t.status !== "scheduled") return { error: "Sign-ups are not open." };
  if ((t as { signups_closed?: boolean }).signups_closed) return { error: "Sign-ups are closed." };
  const now = Date.now();
  const withinWindow = t.draft_open_at && now >= new Date(t.draft_open_at).getTime() && (!t.draft_close_at || now < new Date(t.draft_close_at).getTime());
  if (!t.signups_open && !withinWindow) return { error: "Sign-ups are not open." };

  const min2v2 = (t.min_mmr_2v2 as number | null) ?? null;
  const min3v3 = (t.min_mmr_3v3 as number | null) ?? null;
  const peak2v2 = Number((player as { peak_2v2?: string }).peak_2v2) || 0;
  const peak3v3 = Number((player as { peak_3v3?: string }).peak_3v3) || 0;
  const reqs: { label: string; passes: boolean }[] = [];
  if (min2v2) reqs.push({ label: `${min2v2} 2v2`, passes: peak2v2 >= min2v2 });
  if (min3v3) reqs.push({ label: `${min3v3} 3v3`, passes: peak3v3 >= min3v3 });
  if (reqs.length > 0 && !reqs.some((r) => r.passes))
    return { error: `You need at least ${reqs.map((r) => r.label).join(" or ")} peak MMR to join.` };

  if (!confirmTrackerSame && isTrackerStale((player as { tracker_confirmed_at?: string | null }).tracker_confirmed_at)) {
    return { trackerStale: true };
  }
  if (confirmTrackerSame) {
    await supabaseAdmin
      .from("players")
      .update({ tracker_confirmed_at: new Date().toISOString(), must_update_tracker: false })
      .eq("id", player.id);
  }

  const { error } = await supabaseAdmin
    .from("tournament_entries")
    .insert({ tournament_id: tournamentId, player_id: player.id });
  // Ignore duplicate-join (unique constraint) — treat as success.
  if (error && !error.message.toLowerCase().includes("duplicate")) return { error: error.message };

  if (!error) logAnalyticsEvent("draft_join").catch(() => {});

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tournament");
  return { ok: true, message: "Joined." };
}

export async function leaveTournament(tournamentId: string) {
  const player = await currentPlayer();
  if (!player) return { error: "You are not registered." };

  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("status")
    .eq("id", tournamentId)
    .single();
  if (!t) return { error: "Tournament not found." };
  if (t.status === "active") return { error: "You can't leave once the tournament has started." };

  await supabaseAdmin
    .from("tournament_entries")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("player_id", player.id);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tournament");
  return { ok: true, message: "Left." };
}
