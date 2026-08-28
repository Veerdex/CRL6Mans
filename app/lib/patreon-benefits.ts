// The catalog of perks directors can assign to Patreon tiers. Deliberately
// hardcoded rather than admin-created — Patreon tiers themselves live on the
// Patreon campaign (see patreon-tiers-actions.ts's getLiveTierTitles), and
// what a benefit even means (e.g. "name color" wiring into the UI) is a code
// change anyway, so there's no value in a database-backed CRUD layer here.
// To add one: append an entry with a stable, never-reused `id`.
export type PatreonBenefit = {
  id: string;
  title: string;
  description: string;
};

export const PATREON_BENEFITS: PatreonBenefit[] = [];
