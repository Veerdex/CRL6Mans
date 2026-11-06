import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { fantasyAccessOpen, getFantasyViewer, getLeagueView, type MemberView } from "@/app/lib/fantasy-leagues";
import { FANTASY_MIN_MANAGERS } from "@/app/lib/fantasy-rules";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import {
  CancelInviteButton,
  CommissionerSettings,
  DeclineInviteButton,
  InvitePanel,
  JoinLeagueButton,
  LeagueSwitcher,
  LeaveLeagueButton,
  RemoveManagerButton,
} from "../fantasy-client";
import { StatusBadge } from "../status-badge";

export default async function FantasyLeaguePage({ params }: { params: Promise<{ league: string }> }) {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) redirect("/login");
  const viewer = await getFantasyViewer(session.userId);
  if (viewer.isGuest) redirect("/dashboard");
  if (!(await fantasyAccessOpen(viewer))) redirect("/dashboard/fantasy");

  const { league: leagueId } = await params;
  const view = await getLeagueView(leagueId, viewer);
  if (!view || view.league.status === "disbanded") notFound();
  const { league, members, invites, cap, isMember, isCommissioner, isInvited, isRemoved, myLeagues } = view;
  const preDraft = league.status === "pre_draft";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/dashboard/fantasy?tab=all"className="text-xs text-zinc-400 hover:text-white">
            ← All leagues
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-2xl font-bold text-white truncate">{league.name}</h1>
            <StatusBadge status={league.status} />
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            {league.visibility === "private" ? "Private" : "Public"} league
            {view.season ? ` · ${view.season.name}` : ""}
          </p>
        </div>
        <div className="flex items-start gap-3">
          {myLeagues.length > 1 && <LeagueSwitcher current={league.id} leagues={myLeagues} />}
          {!isMember && preDraft && (
            <div className="flex items-start gap-2">
              <JoinLeagueButton
                leagueId={league.id}
                visibility={league.visibility}
                isInvited={isInvited}
                isRemoved={isRemoved}
                full={members.length >= cap}
                canManage={viewer.approved}
              />
              {isInvited && <DeclineInviteButton leagueId={league.id} />}
            </div>
          )}
        </div>
      </div>

      {isInvited && !isMember && preDraft && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 text-sm text-emerald-200">
          You&apos;ve been invited to this league.
        </div>
      )}

      {preDraft && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-300">
          Waiting for an admin to start the fantasy draft. Leagues need at least {FANTASY_MIN_MANAGERS} managers to draft.
        </div>
      )}

      <section className="bg-zinc-800 border border-zinc-700 rounded-xl">
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-white">Managers</h2>
          <span className="text-xs text-zinc-400">
            {members.length}/{cap}
          </span>
        </header>
        <ul className="divide-y divide-zinc-700/60">
          {members.map((m) => (
            <PersonRow
              key={m.accountId}
              person={m}
              tag={m.isCommissioner ? "Commissioner" : m.accountId === viewer.accountId ? "You" : undefined}
              action={
                isCommissioner && preDraft && !m.isCommissioner ? (
                  <RemoveManagerButton leagueId={league.id} accountId={m.accountId} name={m.name} />
                ) : undefined
              }
            />
          ))}
        </ul>
      </section>

      {invites.length > 0 && (isMember || viewer.isStaff) && (
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl">
          <header className="px-4 py-3 border-b border-zinc-700">
            <h2 className="text-sm font-semibold text-white">Pending invites</h2>
          </header>
          <ul className="divide-y divide-zinc-700/60">
            {invites.map((p) => (
              <PersonRow
                key={p.accountId}
                person={p}
                action={isCommissioner && preDraft ? <CancelInviteButton leagueId={league.id} accountId={p.accountId} /> : undefined}
              />
            ))}
          </ul>
        </section>
      )}

      {isCommissioner && preDraft && (
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Invite players</h2>
          <InvitePanel leagueId={league.id} />
        </section>
      )}

      {isCommissioner && league.status !== "complete" && (
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">League settings</h2>
          <CommissionerSettings leagueId={league.id} name={league.name} visibility={league.visibility} />
        </section>
      )}

      {isMember && preDraft && (
        <LeaveLeagueButton
          leagueId={league.id}
          isCreator={viewer.accountId === league.created_by}
          managerCount={members.length}
        />
      )}
    </div>
  );
}

function PersonRow({ person, tag, action }: { person: MemberView; tag?: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <PlayerAvatar discordId={person.discordId} avatar={person.avatar} username={person.username} className="w-8 h-8" cdnSize={64} />
      <span className="flex-1 min-w-0 text-sm text-white truncate">{person.name}</span>
      {tag && <span className="text-[10px] uppercase tracking-wide text-indigo-300">{tag}</span>}
      {action}
    </li>
  );
}
