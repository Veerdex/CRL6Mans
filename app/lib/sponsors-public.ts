import { supabaseAdmin } from "@/app/lib/supabase";

export type PublicSponsorLink = {
  label: string;
  url: string;
};

export type PublicSponsor = {
  id: string;
  name: string;
  logo_url: string | null;
  video_url: string | null;
  links: PublicSponsorLink[];
  promo_code: string | null;
};

export async function getPublicSponsors(): Promise<PublicSponsor[]> {
  const { data } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, logo_url, video_url, links, promo_code")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? []) as PublicSponsor[];
}

export type NavSponsors = {
  topNav: { name: string; imageUrl: string } | null;
  sideNav: { name: string; imageUrl: string } | null;
};

export async function getNavSponsors(): Promise<NavSponsors> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("top_nav_sponsor_id, side_nav_sponsor_id")
    .single();

  const topNavSponsorId = (settings?.top_nav_sponsor_id as string | null) ?? null;
  const sideNavSponsorId = (settings?.side_nav_sponsor_id as string | null) ?? null;
  if (!topNavSponsorId && !sideNavSponsorId) return { topNav: null, sideNav: null };

  const ids = [topNavSponsorId, sideNavSponsorId].filter((id): id is string => !!id);
  const { data: sponsors } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, top_nav_image_url, side_nav_image_url")
    .in("id", ids)
    .eq("status", "active");

  const byId = new Map((sponsors ?? []).map((s) => [s.id, s]));
  const top = topNavSponsorId ? byId.get(topNavSponsorId) : null;
  const side = sideNavSponsorId ? byId.get(sideNavSponsorId) : null;

  return {
    topNav: top?.top_nav_image_url ? { name: top.name, imageUrl: top.top_nav_image_url as string } : null,
    sideNav: side?.side_nav_image_url ? { name: side.name, imageUrl: side.side_nav_image_url as string } : null,
  };
}
