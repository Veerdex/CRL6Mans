import { cookies } from "next/headers";
import { getTierPrices } from "@/app/lib/patreon-entitlements";

export const PATREON_SIM_COOKIE = "patreon_sim_tier";

// Stand-in for an actual Patreon purchase so the two-step onboarding flow
// (buy a tier, then link the account) can be walked end to end without a real
// subscription. Dev-only rather than staff-only: a shipped path that writes
// active_patron state from one click is privilege escalation no matter who
// holds the button, and the real flow can't be exercised in production anyway
// without Patreon's redirect URI pointing at the deployed domain.
export function patreonSimEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function readSimTier(): Promise<string | null> {
  if (!patreonSimEnabled()) return null;
  const cookieStore = await cookies();
  return cookieStore.get(PATREON_SIM_COOKIE)?.value ?? null;
}

// "Tier 1" is the project's price-descending rank, not a stored number, so the
// top tier is derived the same way tierRanks derives rank 1. Free tiers are
// excluded — they carry no entitlements worth simulating.
export async function topPaidTier(): Promise<{ title: string; cents: number } | null> {
  const prices = await getTierPrices();
  const paid = prices
    .filter((t) => t.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.title.localeCompare(b.title));
  return paid[0] ?? null;
}
