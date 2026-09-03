import { supabaseAdmin } from "@/app/lib/supabase";

// benefit id -> the per-tier `value` configured for it, or null when the
// benefit is simply on/off. Callers check membership (`has`) for on/off
// benefits and read the value for configured ones.
export type ResolvedBenefits = Map<string, string | null>;

// Tiers are cumulative by price: a $10 patron holds everything assigned at
// $10 and below. Prices come from patreon_tier_prices (refreshed from the
// live campaign whenever a director opens Tiers & Benefits) rather than from
// accounts.patreon_entitled_cents, because annual pledges, grandfathered
// pledges and pay-above-tier all decouple what a patron pays from what their
// tier lists at — keying on the amount would silently drop them a tier.
//
// Resolving every tier at once (rather than one account at a time) is what
// keeps list pages cheap: two queries total, then any number of accounts map
// their tier title through the result with no further I/O.
export type TierPrice = { title: string; cents: number };

export async function getTierPrices(): Promise<TierPrice[]> {
  const { data } = await supabaseAdmin.from("patreon_tier_prices").select("tier_title, amount_cents");
  return (data ?? []).map((r) => ({ title: r.tier_title as string, cents: (r.amount_cents as number | null) ?? 0 }));
}

// Callers that also need tier ranks fetch the prices once and hand them in,
// so a page reading both still makes one round-trip to patreon_tier_prices.
export async function getBenefitsByTier(prices?: TierPrice[]): Promise<Map<string, ResolvedBenefits>> {
  const [resolvedPrices, { data: rows }] = await Promise.all([
    prices ? Promise.resolve(prices) : getTierPrices(),
    supabaseAdmin.from("patreon_tier_benefits").select("tier_title, benefit_id, value"),
  ]);

  const centsByTitle = new Map<string, number>();
  for (const p of resolvedPrices) centsByTitle.set(p.title, p.cents);

  const byTier = new Map<string, ResolvedBenefits>();
  for (const [title, cents] of centsByTitle) {
    const resolved: ResolvedBenefits = new Map();
    // Highest-priced source tier wins a contested benefit id, so
    // featured-on-support-page can be "large" at $10 and "small" at $2.
    const wonAtCents = new Map<string, number>();
    for (const row of rows ?? []) {
      const sourceCents = centsByTitle.get(row.tier_title as string);
      if (sourceCents === undefined || sourceCents > cents) continue;
      const id = row.benefit_id as string;
      if ((wonAtCents.get(id) ?? -1) > sourceCents) continue;
      wonAtCents.set(id, sourceCents);
      resolved.set(id, (row.value as string | null) ?? null);
    }
    byTier.set(title, resolved);
  }
  return byTier;
}

// The one place a tier is decided. A director-set override wins outright and
// does not require a pledge — that is the whole point of it, since benefits are
// otherwise unobservable until someone actually subscribes. See
// scripts/patreon-tier-override-migration.sql for why it is a separate column
// from the real Patreon fields.
//
// Without an override: a patron on a custom pledge is active_patron with no
// tier attached, so there's nothing to inherit from.
export function effectiveTier(
  patreonStatus: string | null,
  tierTitle: string | null,
  tierOverride: string | null = null,
): string | null {
  return tierOverride ?? (patreonStatus === "active_patron" ? tierTitle : null);
}

// A tier whose price we've never cached (no director has opened the admin
// section since it was created) resolves to no benefits, since inheritance is
// keyed on price.
export function benefitsForTier(
  byTier: Map<string, ResolvedBenefits>,
  patreonStatus: string | null,
  tierTitle: string | null,
  tierOverride: string | null = null,
): ResolvedBenefits {
  const effective = effectiveTier(patreonStatus, tierTitle, tierOverride);
  if (!effective) return new Map();
  return byTier.get(effective) ?? new Map();
}

// featured-on-support-page predates the per-benefit switches and already had
// its own consent column, so it reads and writes accounts.patreon_public
// rather than the prefs map. This constant and benefitPrefTarget are the only
// place that exception lives — the read path below and setBenefitEnabled in
// the settings actions both go through them, so the two cannot drift.
export const PUBLIC_COLUMN_BENEFIT = "featured-on-support-page";

export type BenefitPrefRow = {
  patreon_public?: boolean | null;
  patreon_benefit_prefs?: Record<string, boolean> | null;
};

export function benefitPrefTarget(benefitId: string): "public_column" | "prefs_map" {
  return benefitId === PUBLIC_COLUMN_BENEFIT ? "public_column" : "prefs_map";
}

// Entitlement is only half of it — a patron also has to switch the benefit on.
// Absent from the map means off, which is what makes everything default off
// with no backfill. See scripts/patreon-benefit-prefs-migration.sql.
export function benefitEnabled(row: BenefitPrefRow, benefitId: string): boolean {
  if (benefitPrefTarget(benefitId) === "public_column") return !!row.patreon_public;
  return (row.patreon_benefit_prefs ?? {})[benefitId] === true;
}

// Entitled benefits minus the ones left switched off. Enforcement sites want
// this, not benefitsForTier — that one answers "may they have it", not "do
// they want it".
export type BenefitAccountRow = BenefitPrefRow & {
  patreon_status?: string | null;
  patreon_tier_title?: string | null;
  patreon_tier_override?: string | null;
};

export function enabledBenefitsForAccount(
  byTier: Map<string, ResolvedBenefits>,
  row: BenefitAccountRow,
): ResolvedBenefits {
  const entitled = benefitsForTier(
    byTier,
    row.patreon_status ?? null,
    row.patreon_tier_title ?? null,
    row.patreon_tier_override ?? null,
  );
  return new Map([...entitled].filter(([id]) => benefitEnabled(row, id)));
}

// Tier numbering runs opposite to price — the most expensive tier is "Tier 1" —
// so a tier's number is its position in the price-descending list rather than
// anything stored. Ties break alphabetically so the numbering stays stable
// across renders (same ordering as sortTiersByPriceDesc in
// patreon-tiers-actions.ts).
// Two tiers priced the same get adjacent ranks even though inheritance treats
// them as equivalent, so they render as separate sections holding identical
// benefits. That is a pricing choice to fix on Patreon, not here.
export function tierRanks(prices: TierPrice[]): Map<string, number> {
  const sorted = [...prices].sort((a, b) => b.cents - a.cents || a.title.localeCompare(b.title));
  return new Map(sorted.map((t, i) => [t.title, i + 1]));
}

// A ban revokes supporter status outright (see banPlayer), which already
// clears these columns. The status check is the invariant behind that: it also
// covers accounts banned before that shipped, and any path that could write
// patron fields onto a banned row.
export async function getAccountBenefits(discordId: string): Promise<ResolvedBenefits> {
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("status, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (!account) return new Map();
  if (account.status === "banned") return new Map();

  return enabledBenefitsForAccount(await getBenefitsByTier(), account as BenefitAccountRow);
}

// Lowercased usernames of everyone who is entitled to `benefitId` and has
// switched it on — active patrons, plus anyone a director has pinned to a tier
// for testing. Keyed on username because PlayerName — the component every
// roster, leaderboard and stats table renders names through — only ever
// receives a display name and a username; threading an account id would mean
// reshaping the query behind all ~27 call sites. Usernames are unique per
// account, and lowercasing matches Discord's own case-insensitive uniqueness.
//
// players.username is a Tier 3 mirror that lags the Tier 1 row after a Discord
// rename, and several surfaces (archived rosters, stats snapshots) still read
// off it, so both spellings go in the set rather than leaving a renamed patron
// unbadged on exactly those pages.
export async function getUsernamesWithBenefit(benefitId: string): Promise<Set<string>> {
  const { data: patrons } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, username, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs")
    .neq("status", "banned")
    .or("patreon_status.eq.active_patron,patreon_tier_override.not.is.null");

  if (!patrons?.length) return new Set();

  const byTier = await getBenefitsByTier();
  const entitled = patrons.filter((p) => enabledBenefitsForAccount(byTier, p as BenefitAccountRow).has(benefitId));
  if (entitled.length === 0) return new Set();

  const usernames = new Set<string>();
  for (const p of entitled) if (p.username) usernames.add((p.username as string).toLowerCase());

  const { data: mirrors } = await supabaseAdmin
    .from("players")
    .select("username")
    .in("discord_id", entitled.map((p) => p.discord_id as string));
  for (const m of mirrors ?? []) if (m.username) usernames.add((m.username as string).toLowerCase());

  return usernames;
}
