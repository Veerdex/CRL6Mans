import { supabaseAdmin } from "./supabase";
import { sendChannelMessage } from "./discord-api";
import type { ChannelPost } from "./match-embeds";

// Sends a message to the private Discord channel stored on a match record.
// Silently no-ops if the match has no discord_channel_id.
//
// Takes a whole ChannelPost rather than a string: the ping text in `content` and
// the IDs in `allowed_mentions` have to travel together or Discord strips the
// ping, and every builder in match-embeds.ts derives the two from one list.
export async function notifyMatchChannel(matchId: string, post: ChannelPost): Promise<void> {
  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("discord_channel_id")
    .eq("id", matchId)
    .maybeSingle();
  if (!match?.discord_channel_id) return;
  await sendChannelMessage(
    match.discord_channel_id,
    post.content,
    post.embeds,
    post.allowed_mentions,
  );
}
