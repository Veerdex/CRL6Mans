import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { MediaFeed, type Clip } from "@/app/dashboard/media/media-feed";
import { ClipOfWeek } from "@/app/dashboard/media/clip-of-week";

export default async function MediaPage() {
  const session = await decrypt((await cookies()).get("session")?.value);

  let currentPlayerId: string | null = null;
  let moderator = false;
  if (session?.userId) {
    moderator = await isModerator(session.userId);
    const { data: player } = await supabaseAdmin
      .from("players")
      .select("id, status")
      .eq("discord_id", session.userId)
      .single();
    if (player?.status === "approved") currentPlayerId = player.id;
  }

  const { data: clips } = await supabaseAdmin
    .from("clips")
    .select("id, title, url, embed_url, thumbnail_url, platform, likes_count, created_at")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("clip_of_week_id")
    .single();

  let clipOfWeek: Clip | null = null;
  if (settings?.clip_of_week_id) {
    const { data } = await supabaseAdmin
      .from("clips")
      .select("id, title, url, embed_url, thumbnail_url, platform, likes_count, created_at")
      .eq("id", settings.clip_of_week_id)
      .single();
    clipOfWeek = data as Clip | null;
  }

  let likedClipIds: string[] = [];
  if (currentPlayerId) {
    const { data: likes } = await supabaseAdmin
      .from("clip_likes")
      .select("clip_id")
      .eq("player_id", currentPlayerId);
    likedClipIds = (likes ?? []).map((l) => l.clip_id as string);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Media</h1>
          <p className="text-zinc-400">Clips from the community — like your favorites, the top clip each week gets crowned.</p>
        </div>

        <ClipOfWeek clip={clipOfWeek} isModerator={moderator} />

        <MediaFeed
          clips={(clips ?? []) as Clip[]}
          likedClipIds={likedClipIds}
          canParticipate={currentPlayerId !== null}
          isModerator={moderator}
        />
      </div>
    </div>
  );
}
