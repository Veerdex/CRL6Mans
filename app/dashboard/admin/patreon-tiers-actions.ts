"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchCampaignMembers, fetchCampaignTiers } from "@/app/lib/patreon";
import { getFreshCampaignAccessToken } from "@/app/lib/patreon-sync";
import { PATREON_BENEFITS } from "@/app/lib/patreon-benefits";
import { syncDiscordSupporterRole } from "@/app/lib/patreon-discord-role";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export type LiveTier = { title: string; amountCents: number | null };

// Highest price first, so the admin sees the most valuable tier at the top;
// ties (or unknown prices, e.g. from the self-linked-accounts fallback) break
// alphabetically for a stable order.
function sortTiersByPriceDesc(tiers: LiveTier[]): LiveTier[] {
  return tiers.sort((a, b) => (b.amountCents ?? -1) - (a.amountCents ?? -1) || a.title.localeCompare(b.title));
}

// A free tier isn't something to configure: it grants no paid benefit and hands
// out no Discord role. Its price is still cached below, so anyone already on it
// still resolves — it just stops being offered as a thing to set up.
function withoutFreeTiers(tiers: LiveTier[]): LiveTier[] {
  return tiers.filter((t) => t.amountCents !== 0);
}

// Mirrors live tier prices into patreon_tier_prices, which is what
// patreon-entitlements.ts reads to make tiers cumulative. Kept as a side
// effect of viewing tiers (rather than a separate exported action) so the
// cache can't drift from what the admin is looking at, and so it can't be
// driven from outside with made-up prices. Tiers whose price we couldn't
// determine are skipped rather than cached as 0 — a bogus 0 would make the
// tier inherit nothing.
async function cacheTierPrices(tiers: LiveTier[]): Promise<void> {
  const priced = tiers.filter((t) => t.amountCents !== null);
  if (priced.length === 0) return;
  await supabaseAdmin
    .from("patreon_tier_prices")
    .upsert(
      priced.map((t) => ({ tier_title: t.title, amount_cents: t.amountCents, updated_at: new Date().toISOString() })),
      { onConflict: "tier_title" },
    );
}

// The tiers themselves aren't stored here — they're whatever titles the
// campaign actually has configured on Patreon. Prefer the campaign's own tier
// list (every tier that exists, even brand-new ones with zero subscribers yet
// — this is what lets admins assign benefits before anyone has joined); fall
// back to the member list (tiers with at least one patron) if that fetch
// fails, then to self-linked accounts only if the campaign isn't connected at
// all. Mirrors the fallback in patreon-section.tsx's PatreonAdminSection.
export async function getLiveTiers(): Promise<LiveTier[]> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("patreon_campaign_id, patreon_campaign_refresh_token")
    .single();

  if (settings?.patreon_campaign_id && settings?.patreon_campaign_refresh_token) {
    const fresh = await getFreshCampaignAccessToken();
    if (fresh) {
      const tiers = await fetchCampaignTiers(fresh.accessToken, fresh.campaignId);
      const byTitle = new Map<string, number | null>();
      for (const t of tiers ?? []) if (t.title) byTitle.set(t.title, t.amountCents);
      if (byTitle.size > 0) {
        const live = sortTiersByPriceDesc(Array.from(byTitle, ([title, amountCents]) => ({ title, amountCents })));
        await cacheTierPrices(live);
        return withoutFreeTiers(live);
      }

      const { members } = await fetchCampaignMembers(fresh.accessToken, fresh.campaignId);
      const byMemberTitle = new Map<string, number | null>();
      for (const m of members) if (m.tierTitle) byMemberTitle.set(m.tierTitle, m.tierAmountCents);
      if (byMemberTitle.size > 0) {
        const live = sortTiersByPriceDesc(Array.from(byMemberTitle, ([title, amountCents]) => ({ title, amountCents })));
        await cacheTierPrices(live);
        return withoutFreeTiers(live);
      }
    }
  }

  const { data } = await supabaseAdmin.from("accounts").select("patreon_tier_title").not("patreon_tier_title", "is", null);
  const titles = Array.from(new Set((data ?? []).map((r) => r.patreon_tier_title as string)));
  return withoutFreeTiers(sortTiersByPriceDesc(titles.map((title) => ({ title, amountCents: null }))));
}

export type TierBenefitAssignment = { id: string; value: string | null };

// tier title -> assigned benefits
export async function getTierBenefitMap(): Promise<Record<string, TierBenefitAssignment[]>> {
  const { data } = await supabaseAdmin.from("patreon_tier_benefits").select("tier_title, benefit_id, value");
  const map: Record<string, TierBenefitAssignment[]> = {};
  for (const row of data ?? []) {
    const title = row.tier_title as string;
    (map[title] ??= []).push({ id: row.benefit_id as string, value: (row.value as string | null) ?? null });
  }
  return map;
}

export async function setTierBenefits(
  tierTitle: string,
  assignments: TierBenefitAssignment[],
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can assign benefits." };

  const validIds = new Set(PATREON_BENEFITS.map((b) => b.id));
  if (assignments.some((a) => !validIds.has(a.id))) return { error: "Unknown benefit." };

  const { error: deleteError } = await supabaseAdmin.from("patreon_tier_benefits").delete().eq("tier_title", tierTitle);
  if (deleteError) return { error: deleteError.message };

  if (assignments.length > 0) {
    const { error: insertError } = await supabaseAdmin.from("patreon_tier_benefits").insert(
      assignments.map((a) => ({
        tier_title: tierTitle,
        benefit_id: a.id,
        value: a.value?.trim() || null,
      })),
    );
    if (insertError) return { error: insertError.message };
  }

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export type TierOverride = {
  discordId: string;
  name: string;
  username: string;
  tierTitle: string;
  setAt: string | null;
};

// Tier titles that actually resolve to something. Overrides are matched
// against patreon_tier_prices, not the live campaign, because that cache is
// what patreon-entitlements.ts keys on — offering a tier with no cached price
// would be a dropdown entry that silently grants nothing.
export async function getOverridableTiers(): Promise<LiveTier[]> {
  const { data } = await supabaseAdmin.from("patreon_tier_prices").select("tier_title, amount_cents");
  return withoutFreeTiers(
    sortTiersByPriceDesc(
      (data ?? []).map((r) => ({ title: r.tier_title as string, amountCents: (r.amount_cents as number | null) ?? null })),
    ),
  );
}

export type OverrideCandidate = { discordId: string; name: string; username: string };

export async function getOverrideCandidates(): Promise<OverrideCandidate[]> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, username, display_name")
    .eq("status", "approved");

  return (data ?? [])
    .map((a) => ({
      discordId: a.discord_id as string,
      name: ((a.display_name as string | null) || (a.username as string | null)) ?? "",
      username: (a.username as string | null) ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTierOverrides(): Promise<TierOverride[]> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, username, display_name, patreon_tier_override, patreon_tier_override_set_at")
    .not("patreon_tier_override", "is", null)
    .order("patreon_tier_override_set_at", { ascending: false });

  return (data ?? []).map((a) => ({
    discordId: a.discord_id as string,
    name: ((a.display_name as string | null) || (a.username as string | null)) ?? "",
    username: (a.username as string | null) ?? "",
    tierTitle: a.patreon_tier_override as string,
    setAt: (a.patreon_tier_override_set_at as string | null) ?? null,
  }));
}

// Pass null to clear. The tier is validated against the price cache so an
// override can never point at a title that resolves to no benefits.
export async function setTierOverride(
  discordId: string,
  tierTitle: string | null,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can override tiers." };

  if (tierTitle !== null) {
    const { data: known } = await supabaseAdmin
      .from("patreon_tier_prices")
      .select("tier_title")
      .eq("tier_title", tierTitle)
      .maybeSingle();
    if (!known) return { error: "Unknown tier." };
  }

  const { error } = await supabaseAdmin
    .from("accounts")
    .update({
      patreon_tier_override: tierTitle,
      patreon_tier_override_set_by: tierTitle === null ? null : session.userId,
      patreon_tier_override_set_at: tierTitle === null ? null : new Date().toISOString(),
    })
    .eq("discord_id", discordId);
  if (error) return { error: error.message };

  // Changing the tier changes which supporter role they qualify for.
  await syncDiscordSupporterRole(discordId);

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}
