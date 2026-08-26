import { supabaseAdmin } from "@/app/lib/supabase";
import type { ContentCrop } from "@/app/lib/media-crop";

export type PublicSponsorLink = {
  label: string;
  url: string;
};

export type PublicSponsor = {
  id: string;
  name: string;
  logo_url: string | null;
  video_url: string | null;
  background_image_url: string | null;
  links: PublicSponsorLink[];
  promo_code: string | null;
  content_crop: ContentCrop;
  click_url: string | null;
  phrase: string | null;
  overview: string | null;
  promo_description: string | null;
};

export async function getPublicSponsors(): Promise<PublicSponsor[]> {
  const { data } = await supabaseAdmin
    .from("sponsors")
    .select(
      "id, name, logo_url, video_url, background_image_url, links, promo_code, content_crop, click_url, phrase, overview, promo_description"
    )
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? []) as PublicSponsor[];
}

export type NavSponsors = {
  topNav: { name: string; imageUrl: string; crop: ContentCrop["topNav"]; clickUrl: string | null } | null;
  sideNav: { name: string; imageUrl: string; crop: ContentCrop["sideNav"]; clickUrl: string | null } | null;
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
    .select("id, name, top_nav_image_url, side_nav_image_url, content_crop, click_url")
    .in("id", ids)
    .eq("status", "active");

  const byId = new Map((sponsors ?? []).map((s) => [s.id, s]));
  const top = topNavSponsorId ? byId.get(topNavSponsorId) : null;
  const side = sideNavSponsorId ? byId.get(sideNavSponsorId) : null;

  return {
    topNav: top?.top_nav_image_url
      ? {
          name: top.name,
          imageUrl: top.top_nav_image_url as string,
          crop: (top.content_crop as ContentCrop | null)?.topNav,
          clickUrl: (top.click_url as string | null) ?? null,
        }
      : null,
    sideNav: side?.side_nav_image_url
      ? {
          name: side.name,
          imageUrl: side.side_nav_image_url as string,
          crop: (side.content_crop as ContentCrop | null)?.sideNav,
          clickUrl: (side.click_url as string | null) ?? null,
        }
      : null,
  };
}

export type SettingsTabTheme = {
  name: string;
  accent: string;
  shell: string;
  secondary: string;
  mode: "light" | "dark";
} | null;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export async function getSettingsTabTheme(): Promise<SettingsTabTheme> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("settings_tab_sponsor_id")
    .single();

  const sponsorId = (settings?.settings_tab_sponsor_id as string | null) ?? null;
  if (!sponsorId) return null;

  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("name, status, theme_name, theme_accent, theme_shell, theme_secondary, theme_mode")
    .eq("id", sponsorId)
    .eq("status", "active")
    .single();
  if (!sponsor?.theme_name) return null;

  const accent = sponsor.theme_accent as string | null;
  const shell = sponsor.theme_shell as string | null;
  const secondary = sponsor.theme_secondary as string | null;
  if (!accent || !shell || !secondary) return null;
  if (!HEX_COLOR.test(accent) || !HEX_COLOR.test(shell) || !HEX_COLOR.test(secondary)) return null;

  return {
    name: sponsor.theme_name as string,
    accent,
    shell,
    secondary,
    mode: sponsor.theme_mode === "dark" ? "dark" : "light",
  };
}
