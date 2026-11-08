import { Suspense } from "react";
import { type MemberView } from "@/app/lib/fantasy-leagues";
import { leagueFromParams, type LeagueAccess } from "./league-access";
import { TabSkeleton } from "./tab-skeleton";
import { FANTASY_MIN_MANAGERS } from "@/app/lib/fantasy-rules";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import {
  CancelInviteButton,
  CommissionerSettings,
  DeclineInviteButton,
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

      {preDraft && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-300 text-center">
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
              tag={m.isCommissioner ? "Owner" : m.accountId === viewer.accountId ? "You" : undefined}
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

      {isCommissioner && preDraft && league.visibility === "private" && (
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
        <div className="flex justify-center">
          <LeaveLeagueButton
            leagueId={league.id}
            isCreator={viewer.accountId === league.created_by}
            managerCount={members.length}
          />
        </div>
      )}
    </div>
  );
}

function PersonRow({ person, tag, action }: { person: MemberView; tag?: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <PlayerAvatar discordId={person.discordId} avatar={person.avatar} username={person.username} className="w-8 h-8" cdnSize={64} />
      <div className="flex-1 min-w-0 flex whitespace-nowrap">
        <PlayerName
          displayName={person.name}
          username={person.username ?? person.name}
          discordId={person.discordId || null}
          className="text-sm text-white"
        />
      </div>
      {tag && <span className="text-[10px] uppercase tracking-wide text-indigo-300">{tag}</span>}
      {action}
    </li>
  );
}
