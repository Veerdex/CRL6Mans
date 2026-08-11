"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

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

export type SponsorTier = "small" | "big";

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
  tier: SponsorTier;
  logo_url: string | null;
  video_url: string | null;
  links: SponsorLink[];
  promo_code: string | null;
  members: SponsorMember[];
};

export async function getSponsorsWithMembers(): Promise<Sponsor[]> {
  const session = await getSession();
  if (!session?.userId || !(await isDirectorVerified(session.userId))) return [];

  const { data: sponsors } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, invite_token, max_uses, status, created_at, tier, logo_url, video_url, links, promo_code")
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
  tier: SponsorTier = "small",
  logoUrl?: string
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can add sponsors." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Sponsor name is required." };
  if (!Number.isInteger(maxUses) || maxUses < 1) return { error: "Max uses must be at least 1." };
  if (tier !== "small" && tier !== "big") return { error: "Invalid tier." };

  const { error } = await supabaseAdmin.from("sponsors").insert({
    name: trimmed,
    invite_token: randomUUID(),
    max_uses: maxUses,
    tier,
    logo_url: logoUrl?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/sponsors");
  return { ok: true };
}

export async function updateSponsorDetails(
  sponsorId: string,
  details: {
    tier: SponsorTier;
    logoUrl: string;
    videoUrl: string;
    links: SponsorLink[];
    promoCode: string;
  }
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  if (details.tier !== "small" && details.tier !== "big") return { error: "Invalid tier." };

  const links = details.links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label && l.url);

  const { error } = await supabaseAdmin
    .from("sponsors")
    .update({
      tier: details.tier,
      logo_url: details.logoUrl.trim() || null,
      video_url: details.videoUrl.trim() || null,
      links,
      promo_code: details.promoCode.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sponsorId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/sponsors");
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
  revalidatePath("/sponsors");
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
  revalidatePath("/sponsors");
  return { ok: true };
}

export async function removeSponsorMember(memberId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit sponsors." };

  const { error } = await supabaseAdmin.from("sponsor_members").delete().eq("id", memberId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/sponsors");
  return { ok: true };
}
