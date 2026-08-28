// Canonical list of dashboard nav tabs an admin can force to always show or
// always hide, overriding the normal automatic visibility rules computed in
// app/dashboard/layout.tsx. Onboarding/auth/staff-gated tabs (welcome,
// register, settings, admin, testreplay) are intentionally excluded — those
// are tied to registration/session state, not content availability.
export const NAV_TAB_OPTIONS = [
  { key: "home", label: "Home" },
  { key: "myteam", label: "My Team" },
  { key: "teams", label: "Teams" },
  { key: "players", label: "Players" },
  { key: "stats", label: "Stats" },
  { key: "podium", label: "Podium" },
  { key: "draft", label: "Live Draft" },
  { key: "season", label: "Season" },
  { key: "schedule", label: "Schedule" },
  { key: "scrims", label: "Scrims" },
  { key: "wagers", label: "Wagers" },
  { key: "game", label: "Game" },
  { key: "sponsors", label: "Sponsors" },
  { key: "media", label: "Media" },
  { key: "patreon", label: "Support Us" },
] as const;

export type NavTabKey = (typeof NAV_TAB_OPTIONS)[number]["key"];
export type NavTabVisibility = "auto" | "shown" | "hidden";
export type NavTabOverrides = Record<string, "shown" | "hidden">;

export function applyNavTabOverrides(keys: string[], overrides: NavTabOverrides): string[] {
  const result = keys.filter((k) => overrides[k] !== "hidden");
  for (const { key } of NAV_TAB_OPTIONS) {
    if (overrides[key] === "shown" && !result.includes(key)) result.push(key);
  }
  return result;
}
