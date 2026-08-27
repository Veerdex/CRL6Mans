import { cookies } from "next/headers";
import Link from "next/link";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { MediaFeed, type Clip } from "@/app/media/media-feed";
import { ClipOfWeek } from "@/app/media/clip-of-week";

export const dynamic = "force-dynamic";

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
    <div className="min-h-screen bg-zinc-950 px-6 py-16">
      {session?.userId && (
        <div className="max-w-4xl mx-auto mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      )}
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
