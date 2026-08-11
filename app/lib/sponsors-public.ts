import { supabaseAdmin } from "@/app/lib/supabase";

export type PublicSponsorLink = {
  label: string;
  url: string;
};

export type PublicSponsor = {
  id: string;
  name: string;
  tier: "small" | "big";
  logo_url: string | null;
  video_url: string | null;
  links: PublicSponsorLink[];
  promo_code: string | null;
};

export async function getPublicSponsors(): Promise<PublicSponsor[]> {
  const { data } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, tier, logo_url, video_url, links, promo_code")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const sponsors = (data ?? []) as PublicSponsor[];
  return [...sponsors].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "big" ? -1 : 1));
}
