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
export async function getBenefitsByTier(): Promise<Map<string, ResolvedBenefits>> {
  const [{ data: prices }, { data: rows }] = await Promise.all([
    supabaseAdmin.from("patreon_tier_prices").select("tier_title, amount_cents"),
    supabaseAdmin.from("patreon_tier_benefits").select("tier_title, benefit_id, value"),
  ]);

  const centsByTitle = new Map<string, number>();
  for (const p of prices ?? []) centsByTitle.set(p.tier_title as string, (p.amount_cents as number | null) ?? 0);

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

// A patron on a custom pledge is active_patron with no tier attached, so
// there's nothing to inherit from; likewise a tier whose price we've never
// cached (no director has opened the admin section since it was created).
export function benefitsForTier(
  byTier: Map<string, ResolvedBenefits>,
  patreonStatus: string | null,
  tierTitle: string | null,
): ResolvedBenefits {
  if (patreonStatus !== "active_patron" || !tierTitle) return new Map();
  return byTier.get(tierTitle) ?? new Map();
}

export async function getAccountBenefits(discordId: string): Promise<ResolvedBenefits> {
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("patreon_status, patreon_tier_title")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (account?.patreon_status !== "active_patron") return new Map();

  return benefitsForTier(
    await getBenefitsByTier(),
    account.patreon_status as string,
    account.patreon_tier_title as string | null,
  );
}

// Lowercased usernames of every active patron whose resolved benefits include
// `benefitId`. Keyed on username because PlayerName — the component every
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
    .select("discord_id, username, patreon_tier_title")
    .eq("patreon_status", "active_patron");

  if (!patrons?.length) return new Set();

  const byTier = await getBenefitsByTier();
  const entitled = patrons.filter((p) =>
    benefitsForTier(byTier, "active_patron", p.patreon_tier_title as string | null).has(benefitId),
  );
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
