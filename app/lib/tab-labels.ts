// Canonical set of dashboard "tabs" tracked for the admin Tab Visits chart.
// Keys match the URL segment right after /dashboard (e.g. /dashboard/wagers -> "wagers").
export const TAB_LABELS: Record<string, string> = {
  home: "Home",
  welcome: "Get Started",
  "my-team": "My Team",
  teams: "Teams",
  players: "Players",
  stats: "Stats",
  podium: "Podium",
  season: "Season",
  tournament: "Tournament",
  schedule: "Schedule",
  draft: "Live Draft",
  scrims: "Scrims",
  settings: "Settings",
  register: "Register",
  about: "About",
  wagers: "Wagers",
  game: "Game",
  admin: "Admin",
  "test-replay": "Replay Test",
};

export function tabFromPathname(pathname: string): string | null {
  if (pathname === "/dashboard") return "home";
  const slug = pathname.match(/^\/dashboard\/([^/]+)/)?.[1] ?? null;
  return slug && slug in TAB_LABELS ? slug : null;
}
