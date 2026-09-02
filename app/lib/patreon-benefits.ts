// The catalog of perks directors can assign to Patreon tiers. Deliberately
// hardcoded rather than admin-created — Patreon tiers themselves live on the
// Patreon campaign (see patreon-tiers-actions.ts's getLiveTiers), and
// what a benefit even means (e.g. "name color" wiring into the UI) is a code
// change anyway, so there's no value in a database-backed CRUD layer here.
// To add one: append an entry with a stable, never-reused `id`.
export type PatreonBenefit = {
  id: string;
  title: string;
  description: string;
};

export const PATREON_BENEFITS: PatreonBenefit[] = [
  {
    id: "colored-username",
    title: "Colored Name",
    description: "Custom name color shown on leaderboards, rosters, and stats pages.",
  },
  {
    id: "supporter-badge",
    title: "Supporter Badge",
    description: "A small badge/icon next to the player's name marking them as a supporter.",
  },
  {
    id: "discord-role",
    title: "Discord role",
    description: "A custom Discord role (and color) granted via the bot.",
  },
  {
    id: "featured-on-support-page",
    title: "Name listed on Support Us tab",
    description: "Player's name shown in the \"Our Patrons\" list on /dashboard/support — size (small/medium/large) varies by tier.",
  },
];
