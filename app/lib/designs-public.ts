import { supabaseAdmin } from "@/app/lib/supabase";
import type { ContentCrop } from "@/app/lib/media-crop";

export type PublicDesign = {
  id: string;
  name: string;
  background_image_url: string | null;
  top_nav_image_url: string | null;
  side_nav_image_url: string | null;
  content_crop: ContentCrop;
};

export async function getPublicDesigns(): Promise<PublicDesign[]> {
  const { data } = await supabaseAdmin
    .from("designs")
    .select("id, name, background_image_url, top_nav_image_url, side_nav_image_url, content_crop")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? []) as PublicDesign[];
}
