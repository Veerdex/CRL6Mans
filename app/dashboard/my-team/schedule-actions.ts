"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getGuildChannels, sendChannelMessage } from "@/app/lib/discord-api";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

function slugName(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function findMatchChannelId(
  homeTeamName: string,
  awayTeamName: string,
): Promise<string | null> {
  try {
    const { data: settings } = await supabaseAdmin
      .from("league_settings").select("match_category_id").single();
    const categoryId: string | null = settings?.match_category_id ?? null;
    const channels = await getGuildChannels();
    const a = slugName(homeTeamName);
    const b = slugName(awayTeamName);
    return (
      channels.find(
        (c) =>
          (c.name === `${a}-vs-${b}` || c.name === `${b}-vs-${a}`) &&
          (!categoryId || c.parent_id === categoryId),
      )?.id ?? null
    );
  } catch {
    return null;
  }
}

type MatchRow = {
  home_team_id: string;
  away_team_id: string;
  status: string;
  scheduled_at: string | null;
  schedule_proposed_by_team_id: string | null;
  schedule_accepted: boolean;
};

async function getCaptainContext(matchId: string): Promise<
  | { ok: true; myTeamId: string; match: MatchRow }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select(
      "home_team_id, away_team_id, status, scheduled_at, schedule_proposed_by_team_id, schedule_accepted",
    )
    .eq("id", matchId)
    .single();

  if (!match) return { ok: false, error: "Match not found." };
  if (match.status === "completed")
    return { ok: false, error: "This match is already completed." };

  if (isAdmin(session.userId)) {
    return { ok: true, myTeamId: match.home_team_id as string, match: match as MatchRow };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id, is_captain")
    .eq("discord_id", session.userId)
    .single();

  if (!player?.team_id) return { ok: false, error: "You are not on a team." };
  if (!player.is_captain)
    return { ok: false, error: "Only captains can manage match scheduling." };
  if (player.team_id !== match.home_team_id && player.team_id !== match.away_team_id)
    return { ok: false, error: "You are not in this match." };

  return { ok: true, myTeamId: player.team_id as string, match: match as MatchRow };
}

export async function proposeMatchTime(
  matchId: string,
  scheduledAt: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  const dt = new Date(scheduledAt);
  if (isNaN(dt.getTime())) return { error: "Invalid date/time." };
  if (dt.getTime() <= Date.now()) return { error: "Scheduled time must be in the future." };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: dt.toISOString(),
      schedule_proposed_by_team_id: myTeamId,
      schedule_accepted: false,
    })
    .eq("id", matchId);

  if (error) return { error: `Failed to save: ${error.message}` };

  try {
    const [{ data: homeTeam }, { data: awayTeam }, { data: myTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", match.home_team_id).single(),
      supabaseAdmin.from("teams").select("name").eq("id", match.away_team_id).single(),
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
    ]);
    const channelId =
      homeTeam?.name && awayTeam?.name
        ? await findMatchChannelId(homeTeam.name, awayTeam.name)
        : null;
    if (channelId && myTeam?.name) {
      const ts = Math.floor(dt.getTime() / 1000);
      const verb = match.scheduled_at ? "proposed a new" : "proposed a";
      await sendChannelMessage(
        channelId,
        `📅 **${myTeam.name}** has ${verb} match time: <t:${ts}:F> (<t:${ts}:R>)\nThe other team must accept on the website.`,
      );
    }
  } catch { /* Discord ping is best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function acceptMatchTime(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };
  const { myTeamId, match } = ctx;

  if (!match.scheduled_at || !match.schedule_proposed_by_team_id)
    return { error: "No match time has been proposed yet." };
  if (match.schedule_accepted) return { error: "This time has already been accepted." };
  if (myTeamId === match.schedule_proposed_by_team_id)
    return { error: "You cannot accept your own proposal." };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({ schedule_accepted: true })
    .eq("id", matchId);

  if (error) return { error: `Failed to accept: ${error.message}` };

  try {
    const [{ data: homeTeam }, { data: awayTeam }, { data: myTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", match.home_team_id).single(),
      supabaseAdmin.from("teams").select("name").eq("id", match.away_team_id).single(),
      supabaseAdmin.from("teams").select("name").eq("id", myTeamId).single(),
    ]);
    const channelId =
      homeTeam?.name && awayTeam?.name
        ? await findMatchChannelId(homeTeam.name, awayTeam.name)
        : null;
    if (channelId && myTeam?.name) {
      const ts = Math.floor(new Date(match.scheduled_at!).getTime() / 1000);
      await sendChannelMessage(
        channelId,
        `✅ **${myTeam.name}** has accepted the match time: <t:${ts}:F>. See you then! 🎮`,
      );
    }
  } catch { /* Discord ping is best-effort */ }

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function withdrawMatchTime(
  matchId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCaptainContext(matchId);
  if (!ctx.ok) return { error: ctx.error };

  const { error } = await supabaseAdmin
    .from("matches")
    .update({
      scheduled_at: null,
      schedule_proposed_by_team_id: null,
      schedule_accepted: false,
    })
    .eq("id", matchId);

  if (error) return { error: `Failed to withdraw: ${error.message}` };

  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
