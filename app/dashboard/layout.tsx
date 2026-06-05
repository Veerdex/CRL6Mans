import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { getPlayerInfo, isAdmin } from "@/app/lib/players";
import NavLink from "./nav-link";

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
  season: {
    href: "/dashboard/season",
    label: "Season",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
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
    icon: icon("M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"),
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
  rules: {
    href: "/dashboard/rules",
    label: "Rules",
    icon: icon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"),
  },
  admin: {
    href: "/dashboard/admin",
    label: "Admin",
    icon: icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"),
  },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  if (!session?.userId) {
    redirect("/login");
  }

  const { status, teamId } = session?.userId
    ? await getPlayerInfo(session.userId)
    : { status: "unregistered" as const, teamId: null };
  const admin = session?.userId ? isAdmin(session.userId) : false;

  let navKeys: string[];
  if (status === "approved") {
    navKeys = [
      "home",
      ...(teamId ? ["myteam"] : []),
      "teams", "players", "draft", "season", "scrims", "settings", "about", "rules",
    ];
  } else if (status === "pending") {
    navKeys = ["home", "about", "rules"];
  } else {
    navKeys = ["home", "register", "about", "rules"];
  }
  if (admin) navKeys.push("admin");

  const navItems = navKeys.map((k) => ALL_NAV[k]);

  const avatarUrl = session?.avatar
    ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  return (
    <div className="flex h-screen bg-zinc-950 text-white">
      <aside className="w-56 flex flex-col bg-zinc-900 border-r border-zinc-800">
        <div className="px-4 py-5 border-b border-zinc-800">
          <span className="text-lg font-bold tracking-tight">CRL 6Mans</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
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

        <div className="p-3 border-t border-zinc-800 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt="avatar" width={32} height={32} className="rounded-full" />
          <span className="text-sm text-zinc-300 truncate">{session?.username ?? "Unknown"}</span>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
