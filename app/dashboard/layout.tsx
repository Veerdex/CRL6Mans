import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { getPlayerInfo, isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import NavLink from "./nav-link";
import { TopNav } from "./top-nav";
import { APP_NAME } from "@/app/lib/constants";
import MobileNav from "./mobile-nav";
import { ServiceWorkerRegistrar } from "./sw-register";
import { NotificationButton } from "./notification-button";
import { PullToRefresh } from "./pull-to-refresh";
import { PwaDesktopHint } from "./pwa-desktop-hint";
import { CoinGrantToast } from "./coin-grant-toast";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ALL_NAV: Record<string, NavItem> = {
  home: {
    href: "/dashboard",
    label: "Home",
    icon: icon("M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"),
  },
  welcome: {
    href: "/dashboard/welcome",
    label: "Get Started",
    icon: icon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01"),
  },
  myteam: {
    href: "/dashboard/my-team",
    label: "My Team",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  },
  teams: {
    href: "/dashboard/teams",
    label: "Teams",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  players: {
    href: "/dashboard/players",
    label: "Players",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>,
  },
  stats: {
    href: "/dashboard/stats",
    label: "Stats",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  podium: {
    href: "/dashboard/podium",
    label: "Podium",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a3 3 0 0 0 3 3M19 4h2v2a3 3 0 0 1-3 3"/></svg>,
  },
  season: {
    href: "/dashboard/season",
    label: "Season",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
  tournament: {
    href: "/dashboard/tournament",
    label: "Tournament",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a3 3 0 0 0 3 3M19 4h2v2a3 3 0 0 1-3 3"/></svg>,
  },
  schedule: {
    href: "/dashboard/schedule",
    label: "Schedule",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  },
  draft: {
    href: "/dashboard/draft",
    label: "Live Draft",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  },
  scrims: {
    href: "/dashboard/scrims",
    label: "Scrims",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  },
  settings: {
    href: "/dashboard/settings",
    label: "Settings",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  },
  register: {
    href: "/dashboard/register",
    label: "Register",
    icon: icon("M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM20 8v6M23 11h-6"),
  },
  about: {
    href: "/dashboard/about",
    label: "About",
    icon: icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"),
  },
  wagers: {
    href: "/dashboard/wagers",
    label: "Wagers",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/><path d="M8 14h.01M16 14h.01"/></svg>,
  },
  game: {
    href: "/dashboard/game",
    label: "Game",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M17 10h.01M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>,
  },
  admin: {
    href: "/dashboard/admin",
    label: "Admin",
    icon: icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"),
  },
  testreplay: {
    href: "/dashboard/test-replay",
    label: "Replay Test",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>,
  },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  if (!session?.userId) {
    redirect("/login");
  }

  const navLayout = cookieStore.get("nav_layout")?.value === "topbar" ? "topbar" : "sidebar";
  const welcomeSeen = cookieStore.get("welcome_seen")?.value === "1";

  const playerInfo = await (session?.userId
    ? getPlayerInfo(session.userId)
    : Promise.resolve({ status: "unregistered" as const, teamId: null, displayName: null }));
  if (playerInfo.status === "banned") redirect("/login");

  // ── Claim pending coin grants on visit ────────────────────────────────────
  let coinGrantStart = 0;
  let coinGrantWeekly = 0;
  if (playerInfo.status === "approved" && session?.userId) {
    const { data: playerCoins } = await supabaseAdmin
      .from("players")
      .select("id, crl_coins, coin_grant_pending_start, coin_grant_pending_weekly")
      .eq("discord_id", session.userId)
      .single();

    const pendingStart = playerCoins?.coin_grant_pending_start ?? false;
    const pendingWeekly = playerCoins?.coin_grant_pending_weekly ?? false;

    if ((pendingStart || pendingWeekly) && playerCoins) {
      const { data: ls } = await supabaseAdmin
        .from("league_settings")
        .select("pending_start_coin_amount")
        .single();

      const startAmount = pendingStart ? ((ls?.pending_start_coin_amount as number | null) ?? 0) : 0;
      const weeklyAmount = pendingWeekly ? 250 : 0;
      const total = startAmount + weeklyAmount;

      if (total > 0) {
        await supabaseAdmin
          .from("players")
          .update({
            crl_coins: (playerCoins.crl_coins ?? 0) + total,
            coin_grant_pending_start: false,
            coin_grant_pending_weekly: false,
          })
          .eq("id", playerCoins.id);
        coinGrantStart = startAmount;
        coinGrantWeekly = weeklyAmount;
      }
    }
  }

  const { status, teamId } = playerInfo;
  const [settingsRes, playersCountRes] = await Promise.all([
    supabaseAdmin.from("league_settings").select("draft_active, season_active, active_tournament_id").single(),
    supabaseAdmin.from("players").select("*", { count: "exact", head: true }).eq("status", "approved").eq("draft_entered", true),
  ]);
  const admin = session?.userId ? await isModerator(session.userId) : false;
  const seasonActive = settingsRes.data?.season_active ?? false;
  const draftActive = settingsRes.data?.draft_active ?? false;
  const activeTournamentId = (settingsRes.data?.active_tournament_id as string | null) ?? null;
  const hasPlayers = (playersCountRes.count ?? 0) > 0;

  // Determine whether the Teams page would show any teams in the current context.
  // Active tournament: check if any player who entered it has been placed on a team.
  // Otherwise: check if any team has at least one player assigned (browsable any time).
  let hasTeams = false;
  if (activeTournamentId) {
    const { data: entries } = await supabaseAdmin
      .from("tournament_entries")
      .select("player_id")
      .eq("tournament_id", activeTournamentId);
    if ((entries ?? []).length > 0) {
      const entryIds = (entries ?? []).map((e: { player_id: string }) => e.player_id);
      const { count: teamedCount } = await supabaseAdmin
        .from("players")
        .select("*", { count: "exact", head: true })
        .in("id", entryIds)
        .not("team_id", "is", null);
      hasTeams = (teamedCount ?? 0) > 0;
    }
  } else {
    const { count: teamedCount } = await supabaseAdmin
      .from("players")
      .select("*", { count: "exact", head: true })
      .not("team_id", "is", null);
    hasTeams = (teamedCount ?? 0) > 0;
  }
  // Stats visible whenever there is live content (active season or active tournament)
  const hasActiveContent = seasonActive || !!activeTournamentId;

  // hasJoined: schedule nav — any current team or prior sign-up
  // inActiveTournament: tournament nav — verified against the specific active tournament
  let hasJoined = !!teamId;
  let inActiveTournament = false;

  if (status === "approved") {
    const { data: me } = await supabaseAdmin
      .from("players").select("id").eq("discord_id", session.userId).single();
    if (me?.id) {
      const [{ count: entryCount }, { count: memberCount }, { count: activeTourneyCount }] = await Promise.all([
        !hasJoined
          ? supabaseAdmin.from("tournament_entries").select("*", { count: "exact", head: true }).eq("player_id", me.id)
          : Promise.resolve({ count: 1 }),
        !hasJoined
          ? supabaseAdmin.from("team_signup_members").select("*", { count: "exact", head: true }).eq("player_id", me.id).eq("status", "accepted")
          : Promise.resolve({ count: 0 }),
        activeTournamentId
          ? supabaseAdmin.from("tournament_entries").select("*", { count: "exact", head: true }).eq("player_id", me.id).eq("tournament_id", activeTournamentId)
          : Promise.resolve({ count: 0 }),
      ]);
      if (!hasJoined) hasJoined = (entryCount ?? 0) > 0 || (memberCount ?? 0) > 0;
      inActiveTournament = (activeTourneyCount ?? 0) > 0;
    }
  }

  const priorityHrefs: string[] = [];
  if (draftActive) priorityHrefs.push("/dashboard/draft");
  if (seasonActive) priorityHrefs.push("/dashboard/season");

  // Stats is a career-wide leaderboard (player_game_stats survives resetSeason),
  // so once any games have ever been recorded it should stay visible through the
  // gap between events too, not just while a season/tournament is live.
  let hasStatsContent = hasActiveContent;
  if (status === "approved" && !hasActiveContent) {
    const { count: statsCount } = await supabaseAdmin
      .from("player_game_stats")
      .select("*", { count: "exact", head: true })
      .limit(1);
    hasStatsContent = (statsCount ?? 0) > 0;
  }

  // Podium nav only shows when there's a non-hidden completed event with a champion.
  let hasPodium = false;
  if (status === "approved") {
    const [{ data: podSeasons }, { data: podTournaments }] = await Promise.all([
      supabaseAdmin.from("seasons").select("summary").eq("hidden_from_home", false).limit(20),
      supabaseAdmin.from("tournaments").select("summary").eq("status", "completed").eq("hidden_from_home", false).limit(20),
    ]);
    const anyChamp = (rows: { summary: unknown }[] | null) =>
      (rows ?? []).some((r) => !!(r.summary as { champion?: string | null } | null)?.champion);
    hasPodium = anyChamp(podSeasons) || anyChamp(podTournaments);
  }

  let navKeys: string[];
  if (status === "approved") {
    navKeys = [
      "home",
      ...(teamId ? ["myteam"] : []),
      ...(inActiveTournament ? ["tournament"] : []),
      ...(hasTeams ? ["teams"] : []),
      ...(hasPlayers ? ["players"] : []),
      ...(hasStatsContent ? ["stats"] : []),
      ...(hasPodium ? ["podium"] : []),
      ...(draftActive ? ["draft"] : []),
      ...(seasonActive ? ["season"] : []),
      ...(hasActiveContent ? ["schedule"] : []),
      "wagers", // always visible — Westside Wages standings persist between events
      "settings", "game",
    ];
  } else if (status === "pending") {
    navKeys = ["home", "game"];
  } else {
    navKeys = ["home", "register", "game"];
  }
  // Onboarding tab — shown until the player dismisses it ("I got it!").
  if (!welcomeSeen) navKeys.unshift("welcome");
  if (admin) navKeys.push("admin", "testreplay");

  const BOTTOM_KEYS = new Set(["settings", "admin", "testreplay"]);
  const mainNavItems = navKeys.filter((k) => !BOTTOM_KEYS.has(k)).map((k) => ALL_NAV[k]);
  const bottomNavItems = navKeys.filter((k) => BOTTOM_KEYS.has(k)).map((k) => ALL_NAV[k]);
  const navItems = [...mainNavItems, ...bottomNavItems];

  const avatarUrl = session?.avatar
    ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  // ── Top + bottom bar layout (desktop preference) ───────────────────────────
  // Mobile chrome (MobileNav) is identical to the sidebar layout; only the
  // desktop header/footer bars differ.
  if (navLayout === "topbar") {
    return (
      <div className="flex flex-col h-screen text-white relative z-[1]">
        <ServiceWorkerRegistrar />

        {/* Top bar — desktop only */}
        <header className="app-topbar hidden md:flex items-center gap-3 px-4 h-14 bg-zinc-900 border-b border-zinc-800 shrink-0">
          <span className="text-lg font-bold tracking-tight shrink-0">{APP_NAME}</span>
          <TopNav items={mainNavItems} />
          <div className="flex items-center gap-1 shrink-0">
            <NotificationButton />
            {bottomNavItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          <PullToRefresh>{children}</PullToRefresh>
        </main>
        <CoinGrantToast startAmount={coinGrantStart} weeklyAmount={coinGrantWeekly} />

        {/* Bottom bar — desktop only */}
        <footer className="app-bottombar hidden md:flex items-center justify-between gap-4 px-4 h-12 bg-zinc-900 border-t border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt="avatar" width={28} height={28} className="rounded-full shrink-0" />
            <span className="text-sm text-zinc-300 truncate">{playerInfo.displayName ?? session?.username ?? "Unknown"}</span>
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

        <MobileNav items={navItems} username={session?.username ?? "Unknown"} displayName={playerInfo.displayName} avatarUrl={avatarUrl} status={status} priorityHrefs={priorityHrefs} />
      </div>
    );
  }

  return (
    <div className="flex h-screen text-white relative z-[1]">
      <ServiceWorkerRegistrar />
      <aside className="hidden md:flex w-56 flex-col bg-zinc-900 border-r border-zinc-800">
        <div className="px-4 py-5 border-b border-zinc-800">
          <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {mainNavItems.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {status === "pending" && (
          <div className="mx-3 mb-3 px-3 py-2 bg-yellow-900/40 border border-yellow-700/50 rounded-lg text-xs text-yellow-300">
            Registration pending admin review.
          </div>
        )}

        {status === "rejected" && (
          <div className="mx-3 mb-3 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-xs text-red-300">
            Registration rejected. You may re-submit.
          </div>
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

        <div className="p-3 border-t border-zinc-800 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt="avatar" width={32} height={32} className="rounded-full" />
          <span className="text-sm text-zinc-300 truncate">{playerInfo.displayName ?? session?.username ?? "Unknown"}</span>
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

      <main className="flex-1 overflow-hidden">
        <PullToRefresh>{children}</PullToRefresh>
      </main>
      <CoinGrantToast startAmount={coinGrantStart} weeklyAmount={coinGrantWeekly} />

      <MobileNav items={navItems} username={session?.username ?? "Unknown"} displayName={playerInfo.displayName} avatarUrl={avatarUrl} status={status} priorityHrefs={priorityHrefs} />
    </div>
  );
}
