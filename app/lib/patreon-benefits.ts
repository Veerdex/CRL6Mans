// The catalog of perks directors can assign to Patreon tiers. Deliberately
// hardcoded rather than admin-created — Patreon tiers themselves live on the
// Patreon campaign (see patreon-tiers-actions.ts's getLiveTiers), and
// what a benefit even means (e.g. "name color" wiring into the UI) is a code
// change anyway, so there's no value in a database-backed CRUD layer here.
// To add one: append an entry with a stable, never-reused `id`.
//
// Tiers are cumulative by price — see patreon-entitlements.ts. Assign a
// benefit only to the cheapest tier that should get it; every tier above
// inherits it. The exception is a benefit that means something *different*
// higher up (name size on the Support Us tab): assign it at each tier with a
// different `value`, and the highest tier the patron qualifies for wins.
export type PatreonBenefit = {
  id: string;
  title: string;
  description: string;
  // Set when the benefit is configured per-tier rather than being on/off.
  // Shown as the label on the admin's value input.
  valueLabel?: string;
  // Granted for the whole tier with nothing for the patron to decide, so the
  // settings card states it rather than offering a switch. Entitlement still
  // applies; only the opt-in step is skipped.
  alwaysOn?: boolean;
};

export const PATREON_BENEFITS: PatreonBenefit[] = [
  {
    id: "supporter-badge",
    title: "Supporter Badge",
    description: "A small badge/icon next to the player's name marking them as a supporter.",
  },
  {
    id: "discord-role",
    title: "Discord role",
    description:
      "A supporter-only Discord role in the league server, granted and removed automatically as this switch is flipped.",
    valueLabel: "Discord role name",
  },
  {
    id: "featured-on-support-page",
    title: "Name listed on Support Us tab",
    description: "Player's name shown in the \"Our Patrons\" list on /dashboard/support — size (small/medium/large) varies by tier.",
    valueLabel: "Name size (large / medium / small)",
  },
  {
    id: "colored-username",
    title: "Colored Name",
    description:
      "Pick your name color in Settings and it follows you everywhere your name shows — leaderboards, rosters, stats pages. You can add a border too; its color is set for you from the color you pick.",
  },
  {
    id: "avatar-border",
    title: "Avatar Border",
    description: "A decorative border around the player's avatar everywhere it appears.",
  },
  {
    id: "name-glint",
    title: "Custom Name Glint",
    description:
      "Pick 2 to 4 colors in Settings and your name sweeps between them. Replaces Colored Name while it is on.",
  },
  {
    id: "early-signup-access",
    title: "Early Signup Access",
    description: "Can sign up for tournaments one week before sign-ups open to everyone.",
    alwaysOn: true,
  },
  {
    id: "discord-supporter-channel",
    title: "Discord Supporter Channel",
    description: "Access to the private supporters-only channel in the Discord server.",
    alwaysOn: true,
  },
];

const ALWAYS_ON = new Set(PATREON_BENEFITS.filter((b) => b.alwaysOn).map((b) => b.id));

export function isAlwaysOnBenefit(benefitId: string): boolean {
  return ALWAYS_ON.has(benefitId);
}
