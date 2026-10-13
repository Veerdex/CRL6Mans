import { supabaseAdmin } from "./supabase";
import { sendChannelMessage } from "./discord-api";
import { orFetch } from "./prefetched";
import type { ChannelPost } from "./match-embeds";

// Sends a message to the private Discord channel stored on a match record.
// Silently no-ops if the match has no discord_channel_id.
//
// Takes a whole ChannelPost rather than a string: the ping text in `content` and
// the IDs in `allowed_mentions` have to travel together or Discord strips the
// ping, and every builder in match-embeds.ts derives the two from one list.
//
// A caller that already selected discord_channel_id passes it as knownChannelId to
// skip the lookup. Passing null is not "no channel" — a caller whose own select
// came back empty still gets the read, so it behaves exactly as if it had not been
// passed. The only way to no-op is for the column to actually be null.
export async function notifyMatchChannel(
  matchId: string,
  post: ChannelPost,
  knownChannelId?: string | null,
): Promise<void> {
  const channelId = await orFetch(knownChannelId, async () => {
    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("discord_channel_id")
      .eq("id", matchId)
      .maybeSingle();
    return (match?.discord_channel_id as string | null) ?? null;
  });
  if (!channelId) return;
  await sendChannelMessage(
    channelId,
    post.content,
    post.embeds,
    post.allowed_mentions,
  );
}
