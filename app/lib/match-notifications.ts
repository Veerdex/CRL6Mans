import { supabaseAdmin } from "./supabase";
import { getGuildRoles, sendChannelMessage } from "./discord-api";

// Returns <@&ROLE_ID> if a matching Discord role exists, otherwise **teamName** as plain fallback.
export async function roleMention(
  teamName: string,
  roles?: Array<{ id: string; name: string }>,
): Promise<string> {
  const list = roles ?? await getGuildRoles();
  const role = list.find((r) => r.name === teamName);
  return role ? `<@&${role.id}>` : `**${teamName}**`;
}

// Sends a message to the private Discord channel stored on a match record.
// Silently no-ops if the match has no discord_channel_id.
export async function notifyMatchChannel(matchId: string, message: string): Promise<void> {
  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("discord_channel_id")
    .eq("id", matchId)
    .maybeSingle();
  if (!match?.discord_channel_id) return;
  await sendChannelMessage(match.discord_channel_id, message);
}
