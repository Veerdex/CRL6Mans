import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { fantasyAccessOpen, getFantasyViewer, getHubData, type LeagueCard } from "@/app/lib/fantasy-leagues";
import { CreateLeagueForm, JoinLeagueButton } from "./fantasy-client";
import { StatusBadge } from "./status-badge";

export default async function FantasyHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) redirect("/login");
  const viewer = await getFantasyViewer(session.userId);
  if (viewer.isGuest) redirect("/dashboard");

  if (!(await fantasyAccessOpen(viewer))) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400">Fantasy isn&apos;t open yet.</p>
      </Shell>
    );
  }

  const hub = await getHubData(viewer);
  if (!hub.season) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400">There&apos;s no fantasy season running right now.</p>
      </Shell>
    );
  }

  // A manager in exactly one league lands straight in it; ?all=1 is the way back.
  const { all } = await searchParams;
  if (hub.myLeagues.length === 1 && all !== "1") redirect(`/dashboard/fantasy/${hub.myLeagues[0].id}`);

  const canCreate = viewer.approved && !hub.hasCreated && hub.season.status === "open";

  return (
    <Shell subtitle={hub.season.name}>
      {!viewer.approved && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-300">
          You can look around, but only approved players can create or join a league.{" "}
          <Link href="/dashboard/register" className="text-indigo-400 hover:underline">
            Register
          </Link>
        </div>
      )}

      {hub.myLeagues.length > 0 && (
        <Section title="My leagues">
          {hub.myLeagues.map((l) => (
            <LeagueRowCard key={l.id} league={l} />
          ))}
        </Section>
      )}

      {hub.invitedLeagues.length > 0 && (
        <Section title="Invites">
          {hub.invitedLeagues.map((l) => (
            <LeagueRowCard key={l.id} league={l} action={<JoinFor league={l} canManage={viewer.approved} />} />
          ))}
        </Section>
      )}

      {canCreate && <CreateLeagueForm />}

      <Section title="All leagues">
        {hub.otherLeagues.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {hub.myLeagues.length + hub.invitedLeagues.length > 0 ? "No other leagues yet." : "No leagues yet."}
          </p>
        ) : (
          hub.otherLeagues.map((l) => (
            <LeagueRowCard key={l.id} league={l} action={<JoinFor league={l} canManage={viewer.approved} />} />
          ))
        )}
      </Section>
    </Shell>
  );
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Fantasy</h1>
        {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
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

function LeagueRowCard({ league, action }: { league: LeagueCard; action?: React.ReactNode }) {
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-4">
      <Link href={`/dashboard/fantasy/${league.id}`} className="flex-1 min-w-0 group">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium truncate group-hover:underline">{league.name}</span>
          <StatusBadge status={league.status} />
          {league.visibility === "private" && <span className="text-[10px] uppercase tracking-wide text-zinc-500">Private</span>}
        </div>
        <p className="text-xs text-zinc-400 mt-0.5">
          {league.memberCount}/{league.cap} managers · Commissioner {league.commissionerName}
        </p>
      </Link>
      {action}
    </div>
  );
}
