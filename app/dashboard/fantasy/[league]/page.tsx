import { Suspense } from "react";
import Link from "next/link";
import { getLeagueSummary, type MemberView } from "@/app/lib/fantasy-leagues";
import type { FantasyLeagueSummary } from "@/app/lib/fantasy-archive";
import { leagueFromParams, type LeagueAccess } from "./league-access";
import { TabSkeleton } from "./tab-skeleton";
import { FANTASY_MIN_MANAGERS, isClosedLeague, isFinalLeague } from "@/app/lib/fantasy-rules";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import {
  AcceptTakeoverButton,
  CancelInviteButton,
  CommissionerSettings,
  DeclineInviteButton,
  HandOverButton,
  InvitePanel,
  JoinLeagueButton,
  LeaveLeagueButton,
  RemoveManagerButton,
} from "../fantasy-client";
import { StatusBadge } from "../status-badge";

export default function FantasyLeaguePage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <Suspense fallback={<TabSkeleton />}>
      <LeagueOverview league={leagueFromParams(params)} />
    </Suspense>
  );
}

async function LeagueOverview({ league: access }: { league: Promise<LeagueAccess> }) {
  const { viewer, view } = await access;
  const { league, members, invites, cap, isMember, isCommissioner, isInvited, isRemoved } = view;
  const preDraft = league.status === "pre_draft";
  const summary = isFinalLeague(league.status) ? await getLeagueSummary(league.id) : null;
  const nameOf = (id: string) => members.find((m) => m.accountId === id)?.name ?? "a departed manager";
  const myOffer = invites.find((i) => i.accountId === viewer.accountId)?.takeoverOf ?? null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="min-w-0 max-w-full">
          <p className="text-sm text-zinc-400">
            {league.visibility === "private" ? "Private" : "Public"} league
            {view.season ? ` · ${view.season.name}` : ""}
          </p>
          <div className="mt-2">
            <StatusBadge status={league.status} />
          </div>
        </div>
        {!isMember && preDraft && (
          <div className="flex items-start justify-center gap-2">
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

      {isInvited && !isMember && preDraft && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 text-sm text-emerald-200 text-center">
          You&apos;ve been invited to this league.
        </div>
      )}

      {myOffer && !isMember && league.status === "active" && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 text-sm text-emerald-200 text-center space-y-3">
          <p>
            You&apos;ve been offered {nameOf(myOffer)}&apos;s old team. You take over its roster, lineup, record and place in the
            waiver order as they stand.
          </p>
          <div className="flex items-start justify-center gap-2">
            <AcceptTakeoverButton leagueId={league.id} />
            <DeclineInviteButton leagueId={league.id} />
          </div>
        </div>
      )}

      {preDraft && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-300 text-center">
          Waiting for an admin to start the fantasy draft. Leagues need at least {FANTASY_MIN_MANAGERS} managers to draft.
        </div>
      )}

      {league.status === "drafting" && (
        <div className="bg-indigo-500/10 border border-indigo-500/40 rounded-xl p-4 text-sm text-indigo-100 text-center">
          The draft is in progress.{" "}
          <Link href={`/dashboard/fantasy/${league.id}/draft`} className="font-semibold underline hover:text-white">
            Go to the draft room
          </Link>
        </div>
      )}

      {summary && <FinalStandings summary={summary} pendingExport={league.status === "ended"} viewerId={viewer.accountId} />}

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
              tag={m.orphaned ? "No manager" : m.isCommissioner ? "Owner" : m.accountId === viewer.accountId ? "You" : undefined}
              action={
                !isCommissioner || isClosedLeague(league.status) || league.status === "drafting" ? undefined : m.orphaned ? (
                  league.status === "active" ? (
                    <HandOverButton leagueId={league.id} teamId={m.accountId} name={m.name} />
                  ) : undefined
                ) : !m.isCommissioner ? (
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
                note={p.takeoverOf ? `Offered ${nameOf(p.takeoverOf)}'s team` : undefined}
                action={
                  isCommissioner && (preDraft || (p.takeoverOf && league.status === "active")) ? (
                    <CancelInviteButton leagueId={league.id} accountId={p.accountId} offer={!!p.takeoverOf} />
                  ) : undefined
                }
              />
            ))}
          </ul>
        </section>
      )}

      {isCommissioner && preDraft && league.visibility === "private" && (
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Invite players</h2>
          <InvitePanel leagueId={league.id} />
        </section>
      )}

      {isCommissioner && !isClosedLeague(league.status) && (
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">League settings</h2>
          <CommissionerSettings leagueId={league.id} name={league.name} visibility={league.visibility} />
        </section>
      )}

      {isMember && (preDraft || league.status === "active") && (
        <div className="flex justify-center">
          <LeaveLeagueButton
            leagueId={league.id}
            isCreator={viewer.accountId === league.created_by}
            managerCount={members.length}
            afterDraft={!preDraft}
            isOwner={isCommissioner}
          />
        </div>
      )}
    </div>
  );
}

function FinalStandings({
  summary,
  pendingExport,
  viewerId,
}: {
  summary: FantasyLeagueSummary;
  pendingExport: boolean;
  viewerId: string | null;
}) {
  const person = new Map(summary.managers.map((m) => [m.id, m]));
  const champion = summary.champion ? person.get(summary.champion) : undefined;
  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-700 text-center space-y-1">
        <h2 className="text-sm font-semibold text-white">Final standings</h2>
        {champion ? (
          <p className="text-sm text-yellow-400">
            Champion: <span className="font-semibold">{champion.id === viewerId ? "You" : champion.name}</span>
          </p>
        ) : (
          <p className="text-xs text-zinc-400">The playoffs didn&apos;t finish before the season ended.</p>
        )}
        {pendingExport && <p className="text-xs text-zinc-500">Final once the event&apos;s archive is exported.</p>}
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-zinc-400">
            <th className="px-4 py-2 text-left font-medium w-10">#</th>
            <th className="py-2 text-left font-medium">Manager</th>
            <th className="py-2 text-center font-medium w-20">W-L-T</th>
            <th className="px-4 py-2 text-right font-medium w-20">PF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/60">
          {summary.standings.map((r) => {
            const m = person.get(r.managerId);
            return (
              <tr key={r.managerId} className={r.managerId === viewerId ? "bg-indigo-500/10" : undefined}>
                <td className={`px-4 py-2 tabular-nums ${r.place <= 3 ? "text-amber-400" : "text-zinc-500"}`}>{r.place}</td>
                <td className="py-2 whitespace-nowrap">
                  {m ? (
                    <PlayerName displayName={m.name} username={m.username ?? m.name} discordId={m.discordId} className="text-sm text-white" />
                  ) : (
                    <span className="text-zinc-400">Unknown</span>
                  )}
                </td>
                <td className="py-2 text-center tabular-nums text-zinc-300">
                  {r.wins}-{r.losses}-{r.ties}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-300">{r.pointsFor.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PersonRow({ person, tag, note, action }: { person: MemberView; tag?: string; note?: string; action?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <PlayerAvatar discordId={person.discordId} avatar={person.avatar} username={person.username} className="w-8 h-8" cdnSize={64} />
      <div className={`flex-1 min-w-0 flex flex-col whitespace-nowrap ${person.orphaned ? "opacity-60" : ""}`}>
        <PlayerName
          displayName={person.name}
          username={person.username ?? person.name}
          discordId={person.discordId || null}
          className="text-sm text-white"
        />
        {note && <span className="text-xs text-zinc-400">{note}</span>}
      </div>
      {tag && <span className={`text-[10px] uppercase tracking-wide ${person.orphaned ? "text-amber-300" : "text-indigo-300"}`}>{tag}</span>}
      {action}
    </li>
  );
}
