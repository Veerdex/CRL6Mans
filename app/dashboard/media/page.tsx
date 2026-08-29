import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { MediaFeed, type Clip } from "@/app/dashboard/media/media-feed";
import { ClipOfWeek } from "@/app/dashboard/media/clip-of-week";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

const CLIP_SELECT = "id, title, url, embed_url, thumbnail_url, platform, likes_count, created_at, players!clips_player_id_fkey(username, display_name)";

type RawClipRow = {
  id: string;
  title: string;
  url: string;
  embed_url: string;
  thumbnail_url: string | null;
  platform: Clip["platform"];
  likes_count: number;
  created_at: string;
  players: { username: string; display_name: string | null } | null;
};

function toClip(row: RawClipRow): Clip {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    embed_url: row.embed_url,
    thumbnail_url: row.thumbnail_url,
    platform: row.platform,
    likes_count: row.likes_count,
    created_at: row.created_at,
    submitted_by_username: row.players?.username ?? null,
    submitted_by_display_name: row.players?.display_name ?? null,
  };
}

export default async function MediaPage() {
  const session = await decrypt((await cookies()).get("session")?.value);

  const [moderator, { data: player }, { data: clips }, { data: settings }] = await Promise.all([
    session?.userId ? isModerator(session.userId) : Promise.resolve(false),
    session?.userId
      ? supabaseAdmin.from("players").select("id, status").eq("discord_id", session.userId).single()
      : Promise.resolve({ data: null as { id: string; status: string } | null }),
    supabaseAdmin
      .from("clips")
      .select(CLIP_SELECT)
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("league_settings").select("clip_of_week_id, clip_confirmations_enabled").single(),
  ]);

  const currentPlayerId: string | null = player?.status === "approved" ? player.id : null;

  const [{ data: clipOfWeekRow }, { data: likes }] = await Promise.all([
    settings?.clip_of_week_id
      ? supabaseAdmin
          .from("clips")
          .select(CLIP_SELECT)
          .eq("id", settings.clip_of_week_id)
          .single()
      : Promise.resolve({ data: null as RawClipRow | null }),
    currentPlayerId
      ? supabaseAdmin.from("clip_likes").select("clip_id").eq("player_id", currentPlayerId)
      : Promise.resolve({ data: [] as { clip_id: string }[] }),
  ]);
  const clipOfWeek = clipOfWeekRow ? toClip(clipOfWeekRow as unknown as RawClipRow) : null;
  const likedClipIds: string[] = (likes ?? []).map((l) => l.clip_id as string);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h1 className="text-4xl font-bold text-white tracking-tight">Media</h1>
            <SponsoredByLine tabKey="media" />
          </div>
          <p className="text-zinc-400">Clips from the community — like your favorites, the top clip each week gets crowned.</p>
        </div>

        <ClipOfWeek clip={clipOfWeek} isModerator={moderator} />

        <MediaFeed
          clips={((clips ?? []) as unknown as RawClipRow[]).map(toClip)}
          likedClipIds={likedClipIds}
          canParticipate={currentPlayerId !== null}
          isModerator={moderator}
          confirmationsEnabled={settings?.clip_confirmations_enabled ?? true}
        />
      </div>
    </div>
  );
}
