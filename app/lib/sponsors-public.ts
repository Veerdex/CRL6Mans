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

export type NavVisual = {
  type: "sponsor" | "design";
  name: string;
  imageUrl: string;
  crop: ContentCrop["topNav"];
  clickUrl: string | null;
} | null;

export type NavVisuals = {
  topNav: NavVisual;
  sideNav: NavVisual;
};

export async function getNavVisuals(): Promise<NavVisuals> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("top_nav_sponsor_id, side_nav_sponsor_id, top_nav_design_id, side_nav_design_id")
    .single();

  const topNavSponsorId = (settings?.top_nav_sponsor_id as string | null) ?? null;
  const sideNavSponsorId = (settings?.side_nav_sponsor_id as string | null) ?? null;
  const topNavDesignId = (settings?.top_nav_design_id as string | null) ?? null;
  const sideNavDesignId = (settings?.side_nav_design_id as string | null) ?? null;
  if (!topNavSponsorId && !sideNavSponsorId && !topNavDesignId && !sideNavDesignId) {
    return { topNav: null, sideNav: null };
  }

  const sponsorIds = [topNavSponsorId, sideNavSponsorId].filter((id): id is string => !!id);
  const designIds = [topNavDesignId, sideNavDesignId].filter((id): id is string => !!id);

  const [{ data: sponsors }, { data: designs }] = await Promise.all([
    sponsorIds.length
      ? supabaseAdmin
          .from("sponsors")
          .select("id, name, top_nav_image_url, side_nav_image_url, content_crop, click_url")
          .in("id", sponsorIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    designIds.length
      ? supabaseAdmin
          .from("designs")
          .select("id, name, top_nav_image_url, side_nav_image_url, content_crop")
          .in("id", designIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
  ]);

  const sponsorById = new Map((sponsors ?? []).map((s) => [s.id, s]));
  const designById = new Map((designs ?? []).map((d) => [d.id, d]));

  function resolve(
    sponsorId: string | null,
    designId: string | null,
    imageField: "top_nav_image_url" | "side_nav_image_url",
    cropKind: "topNav" | "sideNav"
  ): NavVisual {
    const sponsor = sponsorId ? sponsorById.get(sponsorId) : null;
    if (sponsor?.[imageField]) {
      return {
        type: "sponsor",
        name: sponsor.name,
        imageUrl: sponsor[imageField] as string,
        crop: (sponsor.content_crop as ContentCrop | null)?.[cropKind],
        clickUrl: (sponsor.click_url as string | null) ?? null,
      };
    }
    const design = designId ? designById.get(designId) : null;
    if (design?.[imageField]) {
      return {
        type: "design",
        name: design.name,
        imageUrl: design[imageField] as string,
        crop: (design.content_crop as ContentCrop | null)?.[cropKind],
        clickUrl: null,
      };
    }
    return null;
  }

  return {
    topNav: resolve(topNavSponsorId, topNavDesignId, "top_nav_image_url", "topNav"),
    sideNav: resolve(sideNavSponsorId, sideNavDesignId, "side_nav_image_url", "sideNav"),
  };
}

export type TabSponsor = { name: string; logoUrl: string | null; logoCrop: ContentCrop["logo"] };

export async function getTabSponsor(tabKey: string): Promise<TabSponsor | null> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("tab_sponsors")
    .single();

  const sponsorId = (settings?.tab_sponsors as Record<string, string> | null)?.[tabKey] ?? null;
  if (!sponsorId) return null;

  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("name, logo_url, content_crop")
    .eq("id", sponsorId)
    .eq("status", "active")
    .single();
  if (!sponsor?.name) return null;

  return {
    name: sponsor.name as string,
    logoUrl: (sponsor.logo_url as string | null) ?? null,
    logoCrop: (sponsor.content_crop as ContentCrop | null)?.logo,
  };
}

export type SettingsTabTheme = {
  name: string;
  accent: string;
  shell: string;
  secondary: string;
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
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
    .select("name, status, theme_id")
    .eq("id", sponsorId)
    .eq("status", "active")
    .single();
  const themeId = (sponsor?.theme_id as string | null) ?? null;
  if (!themeId) return null;

  const { data: theme } = await supabaseAdmin
    .from("themes")
    .select("name, mode, bg, surface, border, text, muted, accent, secondary, shell")
    .eq("id", themeId)
    .single();
  if (!theme) return null;

  const colors = [theme.bg, theme.surface, theme.border, theme.text, theme.muted, theme.accent, theme.secondary, theme.shell];
  if (colors.some((c) => typeof c !== "string" || !HEX_COLOR.test(c))) return null;

  return {
    name: theme.name as string,
    accent: theme.accent as string,
    shell: theme.shell as string,
    secondary: theme.secondary as string,
    bg: theme.bg as string,
    surface: theme.surface as string,
    border: theme.border as string,
    text: theme.text as string,
    muted: theme.muted as string,
    mode: theme.mode === "dark" ? "dark" : "light",
  };
}
