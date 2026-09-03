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
        return live;
      }

      const { members } = await fetchCampaignMembers(fresh.accessToken, fresh.campaignId);
      const byMemberTitle = new Map<string, number | null>();
      for (const m of members) if (m.tierTitle) byMemberTitle.set(m.tierTitle, m.tierAmountCents);
      if (byMemberTitle.size > 0) {
        const live = sortTiersByPriceDesc(Array.from(byMemberTitle, ([title, amountCents]) => ({ title, amountCents })));
        await cacheTierPrices(live);
        return live;
      }
    }
  }

  const { data } = await supabaseAdmin.from("accounts").select("patreon_tier_title").not("patreon_tier_title", "is", null);
  const titles = Array.from(new Set((data ?? []).map((r) => r.patreon_tier_title as string)));
  return sortTiersByPriceDesc(titles.map((title) => ({ title, amountCents: null })));
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
