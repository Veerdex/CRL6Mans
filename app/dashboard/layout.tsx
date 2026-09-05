import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { cropStyle } from "@/app/lib/media-crop";
import { loadDashboardChrome } from "./layout-data";
import NavLink from "./nav-link";
import { TopNav, type TopNavEntry } from "./top-nav";
import { SidebarNavGroup } from "./sidebar-nav-group";
import { NavLeafContent, PODIUM_HREF, podiumTabClass } from "./podium-glow";
import { applyNavTabOverrides } from "@/app/lib/nav-tabs";
import { AppTitle } from "./app-title";
import MobileNav from "./mobile-nav";
import { ServiceWorkerRegistrar } from "./sw-register";
import { TabVisitTracker } from "./tab-visit-tracker";
import { NotificationButton } from "./notification-button";
import { PullToRefresh } from "./pull-to-refresh";
import { NameDecorationProvider } from "./name-decoration";
import { PwaDesktopHint } from "./pwa-desktop-hint";
import { CoinGrantToast } from "./coin-grant-toast";
import { TeamCutToast } from "./team-cut-toast";
import { LogoutButton } from "./logout-button";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const icon = (d: string, key: string) => (
  <svg key={key} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ALL_NAV: Record<string, NavItem> = {
  home: {
    href: "/dashboard",
    label: "Home",
    icon: icon("M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10", "home-icon"),
  },
  welcome: {
    href: "/dashboard/welcome",
    label: "Get Started",
    icon: icon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01", "welcome-icon"),
  },
  myteam: {
    href: "/dashboard/my-team",
    label: "My Team",
    icon: <svg key="myteam-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  },
  teams: {
    href: "/dashboard/teams",
    label: "Teams",
    icon: <svg key="teams-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  players: {
    href: "/dashboard/players",
    label: "Players",
    icon: <svg key="players-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>,
  },
  stats: {
    href: "/dashboard/stats",
    label: "Stats",
    icon: <svg key="stats-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  podium: {
    href: "/dashboard/podium",
    label: "Podium",
    icon: <svg key="podium-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a3 3 0 0 0 3 3M19 4h2v2a3 3 0 0 1-3 3"/></svg>,
  },
  season: {
    href: "/dashboard/season",
    label: "Season",
    icon: <svg key="season-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
  schedule: {
    href: "/dashboard/schedule",
    label: "Schedule",
    icon: <svg key="schedule-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  },
  draft: {
    href: "/dashboard/draft",
    label: "Live Draft",
    icon: <svg key="draft-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  },
  scrims: {
    href: "/dashboard/scrims",
    label: "Scrims",
    icon: <svg key="scrims-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  },
  settings: {
    href: "/dashboard/settings",
    label: "Settings",
    icon: <svg key="settings-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  },
  register: {
    href: "/dashboard/register",
    label: "Register",
    icon: icon("M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM20 8v6M23 11h-6", "register-icon"),
  },
  about: {
    href: "/dashboard/about",
    label: "About",
    icon: icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "about-icon"),
  },
  wagers: {
    href: "/dashboard/wagers",
    label: "Wagers",
    icon: <svg key="wagers-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/><path d="M8 14h.01M16 14h.01"/></svg>,
  },
  game: {
    href: "/dashboard/game",
    label: "Game",
    icon: <svg key="game-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M17 10h.01M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>,
  },
  admin: {
    href: "/dashboard/admin",
    label: "Admin",
    icon: icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "admin-icon"),
  },
  testreplay: {
    href: "/dashboard/test-replay",
    label: "Replay Analyzer",
    icon: <svg key="testreplay-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>,
  },
  sponsors: {
    href: "/dashboard/sponsors",
    label: "Sponsors",
    icon: <svg key="sponsors-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>,
  },
  media: {
    href: "/dashboard/media",
    label: "Media",
    icon: <svg key="media-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
  },
  patreon: {
    href: "/dashboard/support",
    label: "Support Us",
    icon: <svg key="patreon-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  },
};

// Related tabs are collapsed under a category so the flat nav list doesn't
// keep growing as features get added. A group only renders as a dropdown
// when 2+ of its keys are actually present for the current user/state —
// a lone survivor is shown as a plain top-level item instead.
// Each group icon is its own freshly-created element, not a reference into
// ALL_NAV — React's key-collision check flags the exact same element object
// rendered in two list slots (the group header AND a leaf item's own icon).
// The Community group (Wagers/Media/Game) only collapses into a dropdown
// while an event is live and competing for top-level nav space (Draft/
// Season/Schedule etc. via the Play group). With no active season or
// tournament, there's room for them to stand on their own as full tabs
// instead of being buried in a dropdown.
function getNavGroups(hasActiveContent: boolean): { label: string; icon: React.ReactNode; keys: string[] }[] {
  return [
    {
      label: "Play",
      icon: <svg key="play-group-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a3 3 0 0 0 3 3M19 4h2v2a3 3 0 0 1-3 3"/></svg>,
      keys: ["draft", "season", "schedule"],
    },
    {
      label: "League",
      icon: <svg key="league-group-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>,
      keys: ["myteam", "teams", "players", "stats", "podium"],
    },
    ...(hasActiveContent
      ? [{
          label: "Community",
          icon: <svg key="community-group-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v3.5M12 10.5L6.3 17M12 10.5l5.7 6.5"/></svg>,
          keys: ["wagers", "media", "game"],
        }]
      : []),
  ];
}

function groupNavKeys(keys: string[], navMap: Record<string, NavItem>, navGroups: { label: string; icon: React.ReactNode; keys: string[] }[]): TopNavEntry[] {
  const consumed = new Set<string>();
  const result: TopNavEntry[] = [];
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const group = navGroups.find((g) => g.keys.includes(key));
    if (!group) {
      consumed.add(key);
      result.push(navMap[key]);
      continue;
    }
    group.keys.forEach((k) => consumed.add(k));
    const groupItems = group.keys.filter((k) => keys.includes(k)).map((k) => navMap[k]);
    if (groupItems.length <= 1) {
      if (groupItems.length === 1) result.push(groupItems[0]);
    } else {
      result.push({ label: group.label, icon: group.icon, items: groupItems });
    }
  }
  return result;
}

function isNavGroup(entry: TopNavEntry): entry is Extract<TopNavEntry, { items: NavItem[] }> {
  return "items" in entry;
}


export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  if (!session?.userId) {
    redirect("/login");
  }
  const userId = session!.userId;

  const navLayout = cookieStore.get("nav_layout")?.value === "topbar" ? "topbar" : "sidebar";
  const welcomeSeen = cookieStore.get("welcome_seen")?.value === "1";

  // Every fetch the chrome needs, in one bundle. app/dashboard/layout-data.ts
  // holds the LOAD_MODE switch that decides whether they run in stages or all
  // at once; both modes issue the same queries and return the same shape.
  const {
    playerInfo,
    coinGrantStart,
    coinGrantWeekly,
    teamSignupMessage,
    settings,
    hasPlayers,
    navSponsors,
    staffRole,
    mfaOk,
    hasTeams,
    hasStatsContent,
    hasPodium,
    decorations,
  } = await loadDashboardChrome(userId);
  // The bundle resolves before this runs, so a banned account pays for a few
  // reads on its way out. The coin grant is gated on status inside the loader
  // rather than by this redirect, so nothing is written on that path.
  if (playerInfo.status === "banned") redirect("/login");

  const { status, teamId, isGuest } = playerInfo;
  const admin = staffRole !== null && mfaOk;
  const needsMfa = staffRole !== null && !mfaOk;
  const { seasonActive, draftActive, activeTournamentId } = settings;
  // Stats visible whenever there is live content (active season or active tournament)
  const hasActiveContent = seasonActive || !!activeTournamentId;

  const priorityHrefs: string[] = [];
  if (draftActive) priorityHrefs.push("/dashboard/draft");
  if (seasonActive) priorityHrefs.push("/dashboard/season");

  // Players/Stats/Podium/Wagers/Settings are visible to every logged-in player
  // regardless of registration status — Settings itself renders a reduced view
  // for non-approved players (see settings/page.tsx).
  const commonExtras = [
    ...(hasPlayers ? ["players"] : []),
    ...(hasStatsContent ? ["stats"] : []),
    ...(hasPodium ? ["podium"] : []),
    "wagers", // always visible — Westside Wages standings persist between events
    "sponsors",
    "media",
    "patreon",
    "settings",
    "testreplay",
  ];

  // Pending and unregistered are surfaced identically — both get the
  // "register" nav link and no other distinguishing chrome. Guests (sponsor
  // reps who joined without Discord auth) get neither — no registration, no
  // draft/team/wager access, just enough to browse and manage their own theme.
  let navKeys: string[];
  if (isGuest) {
    navKeys = ["home", "sponsors", "media", "patreon", "settings"];
  } else if (status === "approved") {
    navKeys = [
      "home",
      ...(teamId ? ["myteam"] : []),
      ...(hasTeams ? ["teams"] : []),
      ...(draftActive ? ["draft"] : []),
      ...(seasonActive ? ["season"] : []),
      ...(hasActiveContent ? ["schedule"] : []),
      ...commonExtras,
      "game",
    ];
  } else {
    navKeys = ["home", "register", ...commonExtras, "game"];
  }
  navKeys = applyNavTabOverrides(navKeys, settings.navTabOverrides);

  // Onboarding tab — shown until the player dismisses it ("I got it!").
  if (!welcomeSeen && !isGuest) navKeys.unshift("welcome");
  if (admin) navKeys.push("admin");

  // While a tournament is running, the "Season" tab stands in for it —
  // no separate tournament nav entry, just a relabel driven by the same
  // global flag that distinguishes a tournament-run season from a manual one.
  const navMap: Record<string, NavItem> = activeTournamentId
    ? { ...ALL_NAV, season: { ...ALL_NAV.season, label: "Tournament" } }
    : ALL_NAV;

  const BOTTOM_KEYS = new Set(["settings", "admin", "testreplay"]);
  const mainNavKeys = navKeys.filter((k) => !BOTTOM_KEYS.has(k));
  const mainNavItems = mainNavKeys.map((k) => navMap[k]);
  const bottomNavItems = navKeys.filter((k) => BOTTOM_KEYS.has(k)).map((k) => navMap[k]);
  const navItems = [...mainNavItems, ...bottomNavItems];
  // Grouped view for desktop only — mobile keeps the flat list above since it
  // already has its own bottom-tab + "More" sheet pattern.
  const groupedMainNav = groupNavKeys(mainNavKeys, navMap, getNavGroups(hasActiveContent));

  // Fetched once for the whole layout so both nav layouts share it - a branch
  // that forgot the provider would silently drop every supporter badge and name
  // colour with no error.
  const nameDecorations = Array.from(decorations);
  // The chrome sits outside NameDecorationProvider, so the signed-in patron's
  // own border is read here and handed down rather than pulled from context.
  const ownBorder = decorations.get((session?.username ?? "").toLowerCase())?.border ?? null;
  const content = (
    <NameDecorationProvider decorations={nameDecorations}>
      <PullToRefresh>{children}</PullToRefresh>
    </NameDecorationProvider>
  );

  // ── Top + bottom bar layout (desktop preference) ───────────────────────────
  // Mobile chrome (MobileNav) is identical to the sidebar layout; only the
  // desktop header/footer bars differ.
  if (navLayout === "topbar") {
    return (
      <div className="flex flex-col h-dvh text-white relative z-[1]">
        <ServiceWorkerRegistrar />
        <TabVisitTracker />

        {/* Top bar — desktop only */}
        <header
          className={`app-topbar relative z-20 hidden md:flex items-center gap-3 px-4 h-14 bg-zinc-900 border-b border-zinc-800 shrink-0${navSponsors.topNav ? " has-nav-bg" : ""}`}
        >
          {navSponsors.topNav && (
            <div className="absolute inset-0 overflow-hidden -z-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={navSponsors.topNav.imageUrl}
                alt=""
                className="absolute inset-0 w-full h-full"
                style={cropStyle(navSponsors.topNav.crop)}
              />
              <div className="absolute inset-0 bg-black/55" />
            </div>
          )}
          <span className="text-lg font-bold tracking-tight shrink-0"><AppTitle /></span>
          <TopNav items={groupedMainNav} />
          <div className="flex items-center gap-3 shrink-0">
            {navSponsors.topNav?.type === "sponsor" && (
              <a
                href={navSponsors.topNav.clickUrl || "/dashboard/sponsors"}
                target={navSponsors.topNav.clickUrl ? "_blank" : undefined}
                rel={navSponsors.topNav.clickUrl ? "noopener noreferrer" : undefined}
                className="shrink-0 text-[10px] text-white/80 hover:text-white transition-colors"
                title={navSponsors.topNav.name}
              >
                Sponsored by {navSponsors.topNav.name}
              </a>
            )}
            <NotificationButton />
            {bottomNavItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </header>

        <main className="isolate flex-1 overflow-hidden flex flex-col">
          {needsMfa && <MfaBanner />}
          <div className="flex-1 overflow-hidden">
            {content}
          </div>
        </main>
        <CoinGrantToast startAmount={coinGrantStart} weeklyAmount={coinGrantWeekly} />
        <TeamCutToast message={teamSignupMessage} />

        {/* Bottom bar — desktop only */}
        <footer className="app-bottombar hidden md:flex items-center justify-between gap-4 px-4 h-12 bg-zinc-900 border-t border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <PlayerAvatar discordId={session?.userId ?? null} avatar={session?.avatar ?? null} border={ownBorder} className="w-7 h-7" alt="avatar" />
            <span className="text-sm text-zinc-300 truncate">{playerInfo.displayName ?? session?.username ?? "Unknown"}</span>
            <LogoutButton className="shrink-0" />
          </div>
          <p className="hidden lg:block flex-1 text-center text-[9px] text-zinc-600 truncate px-2">
            © 2026 CRL West 6mans. Website code and design © 2026{" "}
            <a
              href="https://www.linkedin.com/in/grant-koupal-34149a277/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Grant Koupal
            </a>
            .
          </p>
          <p className="text-sm font-medium text-yellow-500 shrink-0 whitespace-nowrap">Ctrl+R to refresh</p>
        </footer>

        <MobileNav items={navItems} username={session?.username ?? "Unknown"} displayName={playerInfo.displayName} avatarDiscordId={session?.userId ?? null} avatarHash={session?.avatar ?? null} avatarBorder={ownBorder} status={status} priorityHrefs={priorityHrefs} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh text-white relative z-[1]">
      <ServiceWorkerRegistrar />
      <TabVisitTracker />
      <aside
        className={`relative z-20 hidden md:flex w-56 flex-col bg-zinc-900 border-r border-zinc-800${navSponsors.sideNav ? " has-nav-bg" : ""}`}
      >
        {navSponsors.sideNav && (
          <div className="absolute inset-0 overflow-hidden -z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={navSponsors.sideNav.imageUrl}
              alt=""
              className="absolute inset-0 w-full h-full"
              style={cropStyle(navSponsors.sideNav.crop)}
            />
            <div className="absolute inset-0 bg-black/55" />
          </div>
        )}
        <div className="px-4 py-5 border-b border-zinc-800">
          <span className="text-lg font-bold tracking-tight"><AppTitle /></span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {groupedMainNav.map((entry) =>
            isNavGroup(entry) ? (
              <SidebarNavGroup key={`group:${entry.label}`} label={entry.label} icon={entry.icon} items={entry.items} />
            ) : (
              <NavLink key={entry.href} href={entry.href} className={entry.href === PODIUM_HREF ? podiumTabClass : ""}>
                <NavLeafContent item={entry} />
              </NavLink>
            )
          )}
        </nav>

        {status === "rejected" && (
          <div className="mx-3 mb-3 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-xs text-red-300">
            Registration rejected. You may re-submit.
          </div>
        )}

        {navSponsors.sideNav?.type === "sponsor" && (
          <a
            href={navSponsors.sideNav.clickUrl || "/dashboard/sponsors"}
            target={navSponsors.sideNav.clickUrl ? "_blank" : undefined}
            rel={navSponsors.sideNav.clickUrl ? "noopener noreferrer" : undefined}
            className="mx-3 mb-3 block text-[10px] text-white/80 hover:text-white transition-colors"
            title={navSponsors.sideNav.name}
          >
            Sponsored by {navSponsors.sideNav.name}
          </a>
        )}

        <div className="px-3 pb-2">
          <NotificationButton />
        </div>

        {bottomNavItems.length > 0 && (
          <div className="px-3 pb-2 space-y-1">
            {bottomNavItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <PlayerAvatar discordId={session?.userId ?? null} avatar={session?.avatar ?? null} border={ownBorder} className="w-8 h-8" alt="avatar" />
            <span className="text-sm text-zinc-300 truncate">{playerInfo.displayName ?? session?.username ?? "Unknown"}</span>
          </div>
          <LogoutButton className="shrink-0" />
        </div>

        <div className="px-4 py-2 border-t border-zinc-800/60">
          <PwaDesktopHint />
          <p className="text-[9px] text-zinc-600 leading-relaxed">
            © 2026 CRL West 6mans. All rights reserved. Website code and design © 2026{" "}
            <a
              href="https://www.linkedin.com/in/grant-koupal-34149a277/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Grant Koupal
            </a>
            . Licensed for use by CRL West 6mans.
          </p>
        </div>
      </aside>

      <main className="isolate flex-1 overflow-hidden flex flex-col">
        {needsMfa && <MfaBanner />}
        <div className="flex-1 overflow-hidden">
          {content}
        </div>
      </main>
      <CoinGrantToast startAmount={coinGrantStart} weeklyAmount={coinGrantWeekly} />
      <TeamCutToast message={teamSignupMessage} />

      <MobileNav items={navItems} username={session?.username ?? "Unknown"} displayName={playerInfo.displayName} avatarDiscordId={session?.userId ?? null} avatarHash={session?.avatar ?? null} avatarBorder={ownBorder} status={status} priorityHrefs={priorityHrefs} />
    </div>
  );
}

function MfaBanner() {
  return (
    <div className="shrink-0 px-4 py-2 bg-red-900/50 border-b border-red-700/50 text-xs sm:text-sm text-red-200 text-center">
      Your staff account needs Discord two-factor authentication enabled to use admin features on this site.
      Enable 2FA in Discord&apos;s User Settings, then log out and back in here to refresh your status.
    </div>
  );
}
