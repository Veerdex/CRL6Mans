import { supabaseAdmin } from "./supabase";
import { sendChannelMessage, getGuildRoles } from "./discord-api";
import { orFetch } from "./prefetched";
import { rolePing, teamPing, type ChannelPost, type Ping } from "./match-embeds";

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

// The ping for "staff need to look at this match", shared by the two escalations
// that pull staff into a match channel: a disputed series result and a reported
// sub rejection. One copy, because the fallback is the subtle part — the stored
// moderator_role_id is the real answer, and the by-name lookup only covers a
// league that never ran `/admin setmoderatorid`.
//
// That fallback is safe here in a way the team pings are not: "moderator" is a
// league-owned role name, not a player-supplied one, so there is no path to
// matching @everyone by name.
export async function moderatorPing(): Promise<Ping | null> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("moderator_role_id")
    .single();
  const roleId = (data?.moderator_role_id as string | null) ?? null;
  return rolePing(roleId) ?? teamPing("moderator", await getGuildRoles());
}
