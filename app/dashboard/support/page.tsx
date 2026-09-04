import { getPatreonUrl } from "@/app/lib/patreon-public";
import { APP_NAME } from "@/app/lib/constants";
import { supabaseAdmin } from "@/app/lib/supabase";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";
import {
  effectiveTier,
  enabledBenefitsForAccount,
  getBenefitsByTier,
  getTierPrices,
  tierRanks,
  type BenefitAccountRow,
} from "@/app/lib/patreon-entitlements";
import { NAME_COLOR_BENEFIT, nameColorStyle } from "@/app/lib/name-color";
import { TierGlow, type FieldSpec, type GlowSpec } from "./tier-glow";
import { AVATAR_BORDER_BENEFIT, getAvatarBorder } from "@/app/lib/avatar-borders";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

const REASONS = [
  "Tournament prize pools that make competing worth it",
  "Server hosting, bot infrastructure, and site costs",
  "Equipment and tools that keep matches running smoothly",
];

// Tier 1 is the most expensive tier, so it reads largest and roomiest and drops
// to two columns to give the scaled-up names room to breathe. Three columns is
// the ceiling everywhere else because the page is only max-w-2xl wide. Ranks
// past the third reuse the smallest treatment rather than shrinking forever.
//
// Each panel's fill is its border color at low alpha, so the two always agree.
// Motion is the other axis of hierarchy: Tier 1 glows hardest and its field of
// light burns brightest, Tier 2 gets both dialled down, Tier 3 neither. Both
// the border glow and the field drifting across the panel are driven by Perlin
// noise rather than keyframes, so they wander instead of repeating on a period
// (see tier-glow.tsx). Each tier gets its own seed so the panels never breathe
// in lockstep.
const TIER_LAYOUT = [
  {
    scale: 1.2,
    columns: "grid-cols-1 sm:grid-cols-2",
    gap: "gap-x-3 gap-y-3",
    titleRem: 2,
    chipEm: 3.45,
    avatars: true,
    border: "#3736ac",
    fill: "rgba(55, 54, 172, 0.20)",
    chipBorderPx: 1.5,
    // Tailwind only emits utilities it can see spelled out, so the hover
    // classes are literals here rather than assembled from a distance.
    hoverRise: "transition-transform duration-200 ease-out hover:-translate-y-1.5",
    glow: {
      rgb: [96, 94, 240],
      borderRgb: [55, 54, 172],
      minBlur: 8,
      maxBlur: 40,
      minAlpha: 0.25,
      maxAlpha: 0.95,
      white: 0.8,
      borderPulse: false,
      speed: 0.22,
      seed: 0,
    } as GlowSpec,
    field: {
      // The lit blue from the glow, not the border blue: #3736ac is dark enough
      // that a field built on it reads as haze rather than light.
      rgb: [96, 94, 240],
      scale: 2.6,
      speed: 0.09,
      maxAlpha: 0.6,
      white: 1,
      seed: 0,
    } as FieldSpec,
  },
  {
    scale: 1.1,
    columns: "grid-cols-2 sm:grid-cols-3",
    gap: "gap-x-2 gap-y-1.5",
    titleRem: 1.75,
    chipEm: 2.76,
    avatars: false,
    border: "#a855f7",
    fill: "rgba(168, 85, 247, 0.14)",
    chipBorderPx: 0.75,
    hoverRise: "transition-transform duration-200 ease-out hover:-translate-y-1",
    glow: {
      rgb: [168, 85, 247],
      borderRgb: [168, 85, 247],
      minBlur: 4,
      maxBlur: 18,
      minAlpha: 0.15,
      maxAlpha: 0.5,
      white: 0.45,
      borderPulse: true,
      speed: 0.17,
      seed: 137.4,
    } as GlowSpec,
    field: {
      rgb: [186, 120, 250],
      scale: 3.1,
      speed: 0.07,
      maxAlpha: 0.28,
      white: 1,
      seed: 41.3,
    } as FieldSpec,
  },
  {
    scale: 1,
    columns: "grid-cols-2 sm:grid-cols-3",
    gap: "gap-x-2 gap-y-1.5",
    titleRem: 1.5,
    chipEm: 2.3,
    avatars: false,
    border: "#ffffff",
    fill: "rgba(255, 255, 255, 0.07)",
    chipBorderPx: 0.75,
    hoverRise: null as string | null,
    glow: null,
    field: null,
  },
];

// Chip padding, height, and avatar are all in em so one font-size per section
// scales the whole chip.
const BASE_FONT_REM = 0.875;

type Patron = {
  name: string;
  discordId: string;
  avatar: string | null;
  color: string | null;
  outline: boolean;
  border: string | null;
};
type TierSection = { tier: string; rank: number; patrons: Patron[] };

export default async function SupportPage() {
  const prices = await getTierPrices();
  const [patreonUrl, { data: accounts }, byTier] = await Promise.all([
    getPatreonUrl(),
    supabaseAdmin
      .from("accounts")
      .select(
        "discord_id, avatar, display_name, username, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs, patreon_name_color, patreon_name_outline, patreon_avatar_border",
      )
      .neq("status", "banned")
      .or("patreon_status.eq.active_patron,patreon_tier_override.not.is.null"),
    getBenefitsByTier(prices),
  ]);
  const ranks = tierRanks(prices);

  // Being listed here is a benefit, not an automatic consequence of pledging:
  // a tier shows up only once a director has assigned featured-on-support-page
  // to it. patreon_public stays a hard gate — a director-set override grants
  // the benefit but never the consent to publish someone's name.
  const byTierTitle = new Map<string, TierSection>();
  for (const account of accounts ?? []) {
    if (!account.patreon_public) continue;

    const status = account.patreon_status as string | null;
    const title = account.patreon_tier_title as string | null;
    const override = (account.patreon_tier_override as string | null) ?? null;

    const tier = effectiveTier(status, title, override);
    if (!tier) continue;
    const rank = ranks.get(tier);
    if (rank === undefined) continue;
    const on = enabledBenefitsForAccount(byTier, account as BenefitAccountRow);
    if (!on.has("featured-on-support-page")) continue;

    const section = byTierTitle.get(tier) ?? { tier, rank, patrons: [] };
    section.patrons.push({
      name: (account.display_name as string | null) || (account.username as string),
      discordId: account.discord_id as string,
      avatar: (account.avatar as string | null) ?? null,
      color: on.has(NAME_COLOR_BENEFIT) ? ((account.patreon_name_color as string | null) ?? null) : null,
      outline: on.has(NAME_COLOR_BENEFIT) && account.patreon_name_outline === true,
      border: on.has(AVATAR_BORDER_BENEFIT)
        ? (getAvatarBorder(account.patreon_avatar_border as string | null)?.id ?? null)
        : null,
    });
    byTierTitle.set(tier, section);
  }

  const sections = Array.from(byTierTitle.values()).sort((a, b) => a.rank - b.rank);
  for (const section of sections) section.patrons.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-10 text-center">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h1 className="text-4xl font-bold text-white tracking-tight">Support {APP_NAME}</h1>
            <SponsoredByLine tabKey="patreon" />
          </div>
          <p className="text-zinc-400">
            {`${APP_NAME} is run by the community, for the community. If you'd like to help keep it going, you can become a Patron — every tier helps.`}
          </p>
        </div>

        <ul className="text-left space-y-3 mx-auto max-w-md">
          {REASONS.map((reason) => (
            <li key={reason} className="flex items-start gap-3 text-zinc-300">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0 text-indigo-400"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>{reason}</span>
            </li>
          ))}
        </ul>

        {patreonUrl ? (
          <a
            href={patreonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Become a Patron
          </a>
        ) : (
          <p className="text-sm text-zinc-500">Patron sign-ups are coming soon — check back shortly.</p>
        )}

        {sections.length > 0 && (
          <div className="space-y-8 pt-4">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Our Patrons</p>

            {sections.map(({ tier, rank, patrons }) => {
              const layout = TIER_LAYOUT[Math.min(rank, TIER_LAYOUT.length) - 1];
              return (
                <TierGlow
                  key={tier}
                  glow={layout.glow}
                  field={layout.field}
                  className="relative overflow-hidden rounded-2xl border p-5 sm:p-6"
                  style={{ backgroundColor: layout.fill, borderColor: layout.border }}
                >
                  <div className={`relative ${rank === 1 ? "space-y-4" : "space-y-3"}`}>
                    <h2 className="flex items-baseline justify-center" style={{ fontSize: `${layout.titleRem}rem` }}>
                      {/* The rank is mirrored invisibly on the left so the tier
                          name lands dead center, rather than the name and rank
                          together being centered as one line. Kept in flow
                          instead of absolutely positioned because the panel
                          clips overflow. */}
                      <span aria-hidden className="invisible font-normal text-[0.5em] text-zinc-400 whitespace-nowrap pr-[0.7em]">
                        (Tier {rank})
                      </span>
                      <span className="font-semibold text-zinc-100">{tier}</span>
                      <span className="font-normal text-[0.5em] text-zinc-400 whitespace-nowrap pl-[0.7em]">(Tier {rank})</span>
                    </h2>
                    <div
                      className={`grid ${layout.columns} ${layout.gap}`}
                      style={{ fontSize: `${(layout.scale * BASE_FONT_REM).toFixed(4)}rem` }}
                    >
                      {patrons.map(({ name, discordId, avatar, color, outline, border }) => (
                        <span
                          key={discordId}
                          className={`flex items-center justify-center gap-[0.5em] text-center break-words min-w-0 px-[0.85em] py-[0.4em] border border-white rounded-lg text-zinc-200 cursor-default select-none ${layout.hoverRise ?? ""}`}
                          style={{
                            backgroundColor: "rgba(0, 0, 0, 0.55)",
                            borderWidth: `${layout.chipBorderPx}px`,
                            minHeight: `${layout.chipEm}em`,
                          }}
                        >
                          {layout.avatars && avatar && (
                            <PlayerAvatar
                              discordId={discordId}
                              avatar={avatar}
                              border={border}
                              style={{ width: "1.7em", height: "1.7em" }}
                            />
                          )}
                          <span className="min-w-0 break-words" style={nameColorStyle(color, outline)}>
                            {name}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </TierGlow>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
