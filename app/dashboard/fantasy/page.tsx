import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { fantasyAccessOpen, getFantasyViewer, getHubData, type LeagueCard } from "@/app/lib/fantasy-leagues";
import { CreateLeagueForm, JoinLeagueButton } from "./fantasy-client";
import { StatusBadge } from "./status-badge";
import { PlayerName } from "@/app/dashboard/player-name";

export default async function FantasyHubPage({ searchParams }: { searchParams: Promise<{ all?: string; tab?: string }> }) {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) redirect("/login");
  const viewer = await getFantasyViewer(session.userId);
  if (viewer.isGuest) redirect("/dashboard");

  if (!(await fantasyAccessOpen(viewer))) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400 text-center">Fantasy isn&apos;t open yet.</p>
      </Shell>
    );
  }

  const hub = await getHubData(viewer);
  if (!hub.season) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400 text-center">There&apos;s no fantasy season running right now.</p>
      </Shell>
    );
  }

  // A manager in exactly one league lands straight in it; ?all=1 or an explicit
  // tab is the way back.
  const { all, tab: tabParam } = await searchParams;
  if (hub.myLeagues.length === 1 && all !== "1" && !tabParam) redirect(`/dashboard/fantasy/${hub.myLeagues[0].id}`);

  const hasOwn = hub.myLeagues.length + hub.invitedLeagues.length > 0;
  const tab: Tab = tabParam === "all" || tabParam === "mine" ? tabParam : hasOwn ? "mine" : "all";
  const canCreate = viewer.approved && !hub.hasCreated && hub.season.status === "open";
  const ownLeague = hub.myLeagues.find((l) => l.isOwner);
  const joinedLeagues = hub.myLeagues.filter((l) => !l.isOwner);

  return (
    <Shell subtitle={hub.season.name}>
      {!viewer.approved && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-300 text-center">
          You can look around, but only approved players can create or join a league.{" "}
          <Link href="/dashboard/register" className="text-indigo-400 hover:underline">
            Register
          </Link>
        </div>
      )}

      <TabSwitch active={tab} />

      {tab === "mine" ? (
        <>
          {ownLeague && (
            <Section title="My League">
              <LeagueRowCard league={ownLeague} />
            </Section>
          )}

          {hub.invitedLeagues.length > 0 && (
            <section className="space-y-2">
              {hub.invitedLeagues.map((l) => (
                <LeagueRowCard key={l.id} league={l} invited action={<JoinFor league={l} canManage={viewer.approved} />} />
              ))}
            </section>
          )}

          {joinedLeagues.length > 0 && (
            <Section title={`Joined (${joinedLeagues.length})`}>
              {joinedLeagues.map((l) => (
                <LeagueRowCard key={l.id} league={l} />
              ))}
            </Section>
          )}

          {hub.myLeagues.length === 0 && (
            <p className="text-sm text-zinc-500 text-center">
              You&apos;re not in a league yet.{" "}
              <Link href="/dashboard/fantasy?tab=all" className="text-indigo-400 hover:underline">
                Browse all leagues
              </Link>
            </p>
          )}

          {canCreate && (
            <div className="flex justify-center">
              <CreateLeagueForm />
            </div>
          )}
        </>
      ) : (
        <section className="space-y-2">
          {hub.otherLeagues.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center">{hasOwn ? "No other leagues yet." : "No leagues yet."}</p>
          ) : (
            hub.otherLeagues.map((l) => (
              <LeagueRowCard key={l.id} league={l} action={<JoinFor league={l} canManage={viewer.approved} />} />
            ))
          )}
        </section>
      )}
    </Shell>
  );
}

type Tab = "mine" | "all";

function TabSwitch({ active }: { active: Tab }) {
  const pill = (tab: Tab, children: React.ReactNode) => (
    <Link
      href={`/dashboard/fantasy?tab=${tab}`}
      aria-current={active === tab ? "page" : undefined}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active === tab ? "bg-indigo-600 text-on-accent" : "text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {children}
    </Link>
  );
  return (
    <div className="flex justify-center">
      <div className="inline-flex gap-1 p-1 bg-zinc-800 border border-zinc-700 rounded-full">
        {pill("mine", "My Leagues")}
        {pill("all", "All Leagues")}
      </div>
    </div>
  );
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-5xl font-bold">
          <span className="text-brand-orange">Fantasy</span> <span className="text-brand-blue">RL</span>
        </h1>
        {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 text-center">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function JoinFor({ league, canManage }: { league: LeagueCard; canManage: boolean }) {
  if (league.status !== "pre_draft") return null;
  return (
    <JoinLeagueButton
      leagueId={league.id}
      visibility={league.visibility}
      isInvited={league.isInvited}
      isRemoved={league.isRemoved}
      full={league.memberCount >= league.cap}
      canManage={canManage}
    />
  );
}

function fillColor(count: number, cap: number) {
  if (count >= cap) return "text-red-400";
  if (count * 2 > cap) return "text-amber-400";
  return "text-emerald-400";
}

function LeagueRowCard({ league, action, invited }: { league: LeagueCard; action?: React.ReactNode; invited?: boolean }) {
  return (
    <div
      className={`group relative bg-zinc-800 hover:bg-zinc-700/70 border rounded-xl px-4 py-3 flex items-center gap-4 shadow-md shadow-black/20 transition duration-200 ease-out motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] hover:shadow-lg hover:shadow-black/30 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-indigo-500 ${
        invited ? "border-emerald-500" : league.isOwner ? "border-white" : "border-zinc-700"
      }`}
    >
      {/* The link's ::after covers the whole card so anywhere on it opens the league. */}
      <Link
        href={`/dashboard/fantasy/${league.id}`}
        className="flex-1 min-w-0 focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 font-medium truncate">{league.name}</span>
          <StatusBadge status={league.status} />        </div>
        <p className="text-xs text-zinc-400 mt-0.5">
          <span className={fillColor(league.memberCount, league.cap)}>
            {league.memberCount >= league.cap ? "Full" : `${league.memberCount}/${league.cap}`}
          </span>{" "}
          {league.memberCount < league.cap && "managers "}· <span className="text-zinc-500">Owner:</span>{" "}
          <PlayerName
            displayName={league.commissionerName}
            username={league.commissionerUsername}
            discordId={league.commissionerDiscordId}
            className="z-10 text-zinc-100"
          />
        </p>
      </Link>
      {action && <div className="relative z-10">{action}</div>}
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-5 h-5 shrink-0 text-zinc-500 transition duration-200 group-hover:text-zinc-200 motion-safe:group-hover:translate-x-1"
      >
        <path
          fillRule="evenodd"
          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
