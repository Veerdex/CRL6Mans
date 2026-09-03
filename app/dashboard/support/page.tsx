import { getPatreonUrl } from "@/app/lib/patreon-public";
import { APP_NAME } from "@/app/lib/constants";
import { supabaseAdmin } from "@/app/lib/supabase";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";
import { benefitsForTier, effectiveTier, getBenefitsByTier, getTierPrices, tierRanks } from "@/app/lib/patreon-entitlements";

const REASONS = [
  "Tournament prize pools that make competing worth it",
  "Server hosting, bot infrastructure, and site costs",
  "Equipment and tools that keep matches running smoothly",
];

// Tier 1 is the most expensive tier, so it reads largest and roomiest and drops
// to two columns to give the scaled-up names room to breathe. Three columns is
// the ceiling everywhere else because the page is only max-w-2xl wide. Ranks
// past the third reuse the smallest treatment rather than shrinking forever.
const TIER_LAYOUT = [
  { scale: 1.2, columns: "grid-cols-1 sm:grid-cols-2", gap: "gap-x-3 gap-y-3" },
  { scale: 1.1, columns: "grid-cols-2 sm:grid-cols-3", gap: "gap-x-2 gap-y-1.5" },
  { scale: 1, columns: "grid-cols-2 sm:grid-cols-3", gap: "gap-x-2 gap-y-1.5" },
];

// Chip padding is in em so one font-size per section scales the whole chip.
const BASE_FONT_REM = 0.875;

type TierSection = { tier: string; rank: number; names: string[] };

export default async function SupportPage() {
  const prices = await getTierPrices();
  const [patreonUrl, { data: accounts }, byTier] = await Promise.all([
    getPatreonUrl(),
    supabaseAdmin
      .from("accounts")
      .select("display_name, username, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public")
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
    if (!benefitsForTier(byTier, status, title, override).has("featured-on-support-page")) continue;

    const section = byTierTitle.get(tier) ?? { tier, rank, names: [] };
    section.names.push((account.display_name as string | null) || (account.username as string));
    byTierTitle.set(tier, section);
  }

  const sections = Array.from(byTierTitle.values()).sort((a, b) => a.rank - b.rank);
  for (const section of sections) section.names.sort((a, b) => a.localeCompare(b));

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

            {sections.map(({ tier, rank, names }) => {
              const layout = TIER_LAYOUT[Math.min(rank, TIER_LAYOUT.length) - 1];
              return (
                <div key={tier} className={rank === 1 ? "space-y-3" : "space-y-2"}>
                  <h2 className="text-base font-semibold text-zinc-300">
                    {tier} <span className="font-normal text-zinc-500">(Tier {rank})</span>
                  </h2>
                  <div
                    className={`grid ${layout.columns} ${layout.gap}`}
                    style={{ fontSize: `${(layout.scale * BASE_FONT_REM).toFixed(4)}rem` }}
                  >
                    {names.map((name) => (
                      <span
                        key={name}
                        className="flex items-center justify-center text-center break-words min-w-0 px-[0.85em] py-[0.4em] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
