"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import type { ContentCrop, CropKind, MediaCrop } from "@/app/lib/media-crop";
import { NAV_TAB_OPTIONS, type NavTabOverrides, type NavTabVisibility } from "@/app/lib/nav-tabs";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export type SponsorMember = {
  id: string;
  account_id: string;
  joined_at: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
};

export type SponsorLink = {
  label: string;
  url: string;
};

export type Sponsor = {
  id: string;
  name: string;
  invite_token: string;
  max_uses: number;
  status: "active" | "disabled";
  created_at: string;
  logo_url: string | null;
  video_url: string | null;
  top_nav_image_url: string | null;
  side_nav_image_url: string | null;
  background_image_url: string | null;
  links: SponsorLink[];
  promo_code: string | null;
  theme_id: string | null;
  content_crop: ContentCrop;
  click_url: string | null;
  phrase: string | null;
  overview: string | null;
  promo_description: string | null;
  members: SponsorMember[];
};

export async function getSponsorsWithMembers(): Promise<Sponsor[]> {
  const session = await getSession();
  if (!session?.userId || !(await isDirectorVerified(session.userId))) return [];

  const { data: sponsors } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, invite_token, max_uses, status, created_at, logo_url, video_url, top_nav_image_url, side_nav_image_url, background_image_url, links, promo_code, theme_id, content_crop, click_url, phrase, overview, promo_description")
    .order("created_at", { ascending: true });
  if (!sponsors || sponsors.length === 0) return [];

  const { data: members } = await supabaseAdmin
    .from("sponsor_members")
    .select("id, sponsor_id, account_id, joined_at")
    .in("sponsor_id", sponsors.map((s) => s.id));

  const accountIds = (members ?? []).map((m) => m.account_id);
  const { data: accounts } = accountIds.length
    ? await supabaseAdmin
        .from("accounts")
        .select("id, discord_id, username, display_name, avatar")
        .in("id", accountIds)
    : { data: [] };
  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

  return sponsors.map((s) => ({
    ...s,
    members: (members ?? [])
      .filter((m) => m.sponsor_id === s.id)
      .map((m) => {
        const account = accountById.get(m.account_id);
        return {
          id: m.id,
          account_id: m.account_id,
          joined_at: m.joined_at,
          discord_id: account?.discord_id ?? "",
          username: account?.username ?? "Unknown",
          display_name: account?.display_name ?? null,
          avatar: account?.avatar ?? null,
        };
      }),
  })) as Sponsor[];
}

export async function createSponsor(
  name: string,
  maxUses: number,
  logoUrl?: string
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can add sponsors." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Sponsor name is required." };
  if (!Number.isInteger(maxUses) || maxUses < 1) return { error: "Max uses must be at least 1." };

  const { error } = await supabaseAdmin.from("sponsors").insert({
    name: trimmed,
    invite_token: randomUUID(),
    max_uses: maxUses,
    logo_url: logoUrl?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  return { ok: true };
}

export async function updateSponsorDetails(
  sponsorId: string,
  details: {
    logoUrl: string;
    videoUrl: string;
    topNavImageUrl: string;
    sideNavImageUrl: string;
    backgroundImageUrl: string;
    links: SponsorLink[];
    promoCode: string;
    themeId: string | null;
    clickUrl: string;
    phrase: string;
    overview: string;
    promoDescription: string;
  }
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const links = details.links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label && l.url);

  const { error } = await supabaseAdmin
    .from("sponsors")
    .update({
      logo_url: details.logoUrl.trim() || null,
      video_url: details.videoUrl.trim() || null,
      top_nav_image_url: details.topNavImageUrl.trim() || null,
      side_nav_image_url: details.sideNavImageUrl.trim() || null,
      background_image_url: details.backgroundImageUrl.trim() || null,
      links,
      promo_code: details.promoCode.trim() || null,
      theme_id: details.themeId || null,
      click_url: details.clickUrl.trim() || null,
      phrase: details.phrase.trim() || null,
      overview: details.overview.trim() || null,
      promo_description: details.promoDescription.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sponsorId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function updateContentCrop(
  sponsorId: string,
  kind: CropKind,
  crop: MediaCrop
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("content_crop")
    .eq("id", sponsorId)
    .single();
  if (!sponsor) return { error: "Sponsor not found." };

  const nextCrop: ContentCrop = { ...((sponsor.content_crop as ContentCrop) ?? {}), [kind]: crop };
  const { error } = await supabaseAdmin
    .from("sponsors")
    .update({ content_crop: nextCrop, updated_at: new Date().toISOString() })
    .eq("id", sponsorId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function updateSponsorMaxUses(
  sponsorId: string,
  maxUses: number
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };
  if (!Number.isInteger(maxUses) || maxUses < 1) return { error: "Max uses must be at least 1." };

  const { error } = await supabaseAdmin
    .from("sponsors")
    .update({ max_uses: maxUses, updated_at: new Date().toISOString() })
    .eq("id", sponsorId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  return { ok: true };
}

export async function toggleSponsorStatus(sponsorId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("status")
    .eq("id", sponsorId)
    .single();
  if (!sponsor) return { error: "Sponsor not found." };

  const nextStatus = sponsor.status === "active" ? "disabled" : "active";
  const { error } = await supabaseAdmin
    .from("sponsors")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", sponsorId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  return { ok: true };
}

export async function removeSponsorMember(memberId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { error } = await supabaseAdmin.from("sponsor_members").delete().eq("id", memberId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  return { ok: true };
}

// `confirmedMemberCount` must match the sponsor's current member count at delete time —
// guards against deleting members the admin never saw confirmed (e.g. someone joined via
// the invite link between page load and the delete click). `sponsor_members` cascades on
// delete, so this is the only chance to catch a stale count before those rows are gone.
export async function deleteSponsor(
  sponsorId: string,
  confirmedMemberCount: number
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { count } = await supabaseAdmin
    .from("sponsor_members")
    .select("id", { count: "exact", head: true })
    .eq("sponsor_id", sponsorId);
  if ((count ?? 0) !== confirmedMemberCount) {
    return { error: "Member count changed — refresh and try again." };
  }

  const { error } = await supabaseAdmin.from("sponsors").delete().eq("id", sponsorId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export type TabPlacement = {
  topNavSponsorId: string | null;
  sideNavSponsorId: string | null;
  settingsTabSponsorId: string | null;
  topNavDesignId: string | null;
  sideNavDesignId: string | null;
};

export async function getTabPlacement(): Promise<TabPlacement> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("top_nav_sponsor_id, side_nav_sponsor_id, settings_tab_sponsor_id, top_nav_design_id, side_nav_design_id")
    .single();
  return {
    topNavSponsorId: (data?.top_nav_sponsor_id as string | null) ?? null,
    sideNavSponsorId: (data?.side_nav_sponsor_id as string | null) ?? null,
    settingsTabSponsorId: (data?.settings_tab_sponsor_id as string | null) ?? null,
    topNavDesignId: (data?.top_nav_design_id as string | null) ?? null,
    sideNavDesignId: (data?.side_nav_design_id as string | null) ?? null,
  };
}

export async function updateSeasonSponsor(
  sponsorId: string | null,
  designId: string | null = null
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ season_sponsor_id: sponsorId, season_design_id: designId })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function updateTabPlacement(
  topNavSponsorId: string | null,
  sideNavSponsorId: string | null,
  settingsTabSponsorId: string | null,
  topNavDesignId: string | null = null,
  sideNavDesignId: string | null = null
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({
      top_nav_sponsor_id: topNavSponsorId,
      side_nav_sponsor_id: sideNavSponsorId,
      settings_tab_sponsor_id: settingsTabSponsorId,
      top_nav_design_id: topNavDesignId,
      side_nav_design_id: sideNavDesignId,
    })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export type TabSponsors = Record<string, string>;

export async function getTabSponsors(): Promise<TabSponsors> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("tab_sponsors")
    .single();
  return (data?.tab_sponsors as TabSponsors | null) ?? {};
}

export async function setTabSponsor(
  key: string,
  sponsorId: string | null
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };
  if (!NAV_TAB_OPTIONS.some((t) => t.key === key)) return { error: "Invalid tab." };

  const sponsors = { ...(await getTabSponsors()) };
  if (sponsorId) sponsors[key] = sponsorId;
  else delete sponsors[key];

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ tab_sponsors: sponsors })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function setAllTabSponsors(
  sponsorId: string | null
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const sponsors: TabSponsors = sponsorId
    ? Object.fromEntries(NAV_TAB_OPTIONS.map((t) => [t.key, sponsorId]))
    : {};

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ tab_sponsors: sponsors })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function getNavTabOverrides(): Promise<NavTabOverrides> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("nav_tab_overrides")
    .single();
  return (data?.nav_tab_overrides as NavTabOverrides | null) ?? {};
}

export async function setNavTabOverride(
  key: string,
  visibility: NavTabVisibility
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };
  if (!NAV_TAB_OPTIONS.some((t) => t.key === key)) return { error: "Invalid tab." };

  const overrides = { ...(await getNavTabOverrides()) };
  if (visibility === "auto") delete overrides[key];
  else overrides[key] = visibility;

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ nav_tab_overrides: overrides })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
