import { supabaseAdmin } from "@/app/lib/supabase";
import { NAME_COLOR_BENEFIT, SUPPORTER_BADGE_BENEFIT, normalizeNameColor } from "@/app/lib/name-color";
import { AVATAR_BORDER_BENEFIT, getAvatarBorder } from "@/app/lib/avatar-borders";
import { NAME_GLINT_BENEFIT, normalizeGlintColors } from "@/app/lib/name-glint";
import { isAlwaysOnBenefit } from "@/app/lib/patreon-benefits";

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

// A tier's Discord role is the guild role named exactly after the tier title, so
// this id is all the configuration there is — see syncDiscordSupporterRole.
export const DISCORD_ROLE_BENEFIT = "discord-role";

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
  // An always-on benefit has no switch, so the prefs map is not consulted for
  // it at all: a stale entry written before it became always-on is inert
  // rather than an override. setBenefitEnabled refuses to write new ones.
  if (isAlwaysOnBenefit(benefitId)) return true;
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

// Everything PlayerName needs to decorate a name, resolved for every patron in
// two queries and handed to the dashboard layout as one map. Badge and colour
// share the fetch because they share the entitlement query and both render on
// every dashboard page; splitting them would double the per-render I/O.
//
// Keyed on lowercased username because PlayerName only ever receives a display
// name and a username. Both spellings are indexed — accounts.username and the
// players.username mirror — since the mirror lags a Discord rename and archived
// rosters and stats snapshots still read off it.
export type NameDecoration = {
  badge: boolean;
  color: string | null;
  outline: boolean;
  border: string | null;
  glint: string[] | null;
};

export type NameStyleRow = {
  patreon_name_color?: string | null;
  patreon_name_outline?: boolean | null;
  patreon_name_glint?: unknown;
};

// Custom Name Glint supersedes Colored Name, and both surfaces that build a
// decoration -- the dashboard-wide map below and the support page -- resolve it
// here rather than each deciding the precedence for itself.
//
// Superseding only happens when the glint is actually usable: a benefit enabled
// before any colours were picked, or a stored value that no longer normalizes,
// leaves the solid colour alone instead of blanking the name.
export function resolveNameStyleFields(
  on: ResolvedBenefits,
  row: NameStyleRow,
): { color: string | null; outline: boolean; glint: string[] | null } {
  const glint = on.has(NAME_GLINT_BENEFIT) ? normalizeGlintColors(row.patreon_name_glint) : null;
  // No outline for a glint: the outline is a text-shadow, which paints behind
  // glyphs the gradient renders transparent, so it would show through as fill.
  if (glint) return { color: null, outline: false, glint };
  const color = on.has(NAME_COLOR_BENEFIT) ? normalizeNameColor(row.patreon_name_color ?? null) : null;
  return { color, outline: color !== null && row.patreon_name_outline === true, glint: null };
}

export async function getNameDecorations(): Promise<Map<string, NameDecoration>> {
  const { data: patrons } = await supabaseAdmin
    .from("accounts")
    .select(
      "discord_id, username, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs, patreon_name_color, patreon_name_outline, patreon_name_glint, patreon_avatar_border",
    )
    .neq("status", "banned")
    .or("patreon_status.eq.active_patron,patreon_tier_override.not.is.null");

  if (!patrons?.length) return new Map();

  const byTier = await getBenefitsByTier();

  const byDiscordId = new Map<string, NameDecoration>();
  for (const p of patrons) {
    const on = enabledBenefitsForAccount(byTier, p as BenefitAccountRow);
    const { color, outline, glint } = resolveNameStyleFields(on, p as NameStyleRow);
    const badge = on.has(SUPPORTER_BADGE_BENEFIT);
    // Resolved against the catalog so an id left over from a retired border
    // renders nothing rather than a broken image.
    const border = on.has(AVATAR_BORDER_BENEFIT)
      ? getAvatarBorder(p.patreon_avatar_border as string | null)?.id ?? null
      : null;
    if (!badge && !color && !border && !glint) continue;
    byDiscordId.set(p.discord_id as string, { badge, color, outline, border, glint });
  }
  if (byDiscordId.size === 0) return new Map();

  const byUsername = new Map<string, NameDecoration>();
  for (const p of patrons) {
    const decoration = byDiscordId.get(p.discord_id as string);
    if (decoration && p.username) byUsername.set((p.username as string).toLowerCase(), decoration);
  }

  const { data: mirrors } = await supabaseAdmin
    .from("players")
    .select("discord_id, username")
    .in("discord_id", Array.from(byDiscordId.keys()));
  for (const m of mirrors ?? []) {
    const decoration = byDiscordId.get(m.discord_id as string);
    if (decoration && m.username) byUsername.set((m.username as string).toLowerCase(), decoration);
  }

  return byUsername;
}
