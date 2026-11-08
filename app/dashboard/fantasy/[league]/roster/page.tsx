import { Suspense } from "react";
import Link from "next/link";
import { getPoolView, type PoolPlayer } from "@/app/lib/fantasy-pool-data";
import { rosterSlots } from "@/app/lib/fantasy-draft-server";
import { LINEUP_SLOTS, SLOT_LABEL, isStarterSlot, type LineupSlot } from "@/app/lib/fantasy-draft";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { TeamLink } from "@/app/dashboard/team-link";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { ComingSoon } from "../coming-soon";
import { TabSkeleton } from "../tab-skeleton";
import { TierBadge } from "../players/pool-table";

export default function FantasyRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ manager?: string }>;
}) {
  return (
    <Suspense fallback={<TabSkeleton />}>
      <Roster league={leagueFromParams(params)} manager={searchParams.then((s) => s.manager ?? null)} />
    </Suspense>
  );
}

async function Roster({ league, manager }: { league: Promise<LeagueAccess>; manager: Promise<string | null> }) {
  const [{ viewer, view }, requested] = await Promise.all([league, manager]);
  const leagueId = view.league.id;

  if (view.league.status === "pre_draft") {
    return (
      <ComingSoon title="Roster">
        {view.isMember
          ? "Your lineup appears here once the fantasy draft runs."
          : "Each manager's lineup appears here once the fantasy draft runs."}
      </ComingSoon>
    );
  }

  const shownId =
    (requested && view.members.some((m) => m.accountId === requested) && requested) ||
    (view.isMember ? viewer.accountId : view.members[0]?.accountId) ||
    null;
  const [pool, slots] = await Promise.all([getPoolView(leagueId, viewer.isStaff), rosterSlots(leagueId)]);
  const playerById = new Map(pool.players.map((p) => [p.id, p]));
  const filled = new Map<LineupSlot, PoolPlayer | undefined>(
    slots.filter((s) => s.manager_id === shownId).map((s) => [s.slot, playerById.get(s.player_id)]),
  );
  const shown = view.members.find((m) => m.accountId === shownId);
  const base = `/dashboard/fantasy/${leagueId}/roster`;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <nav aria-label="Managers" className="flex flex-wrap justify-center gap-2">
        {view.members.map((m) => {
          const active = m.accountId === shownId;
          return (
            <Link
              key={m.accountId}
              href={`${base}?manager=${m.accountId}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active ? "bg-indigo-500 border-indigo-500 text-on-accent" : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              <PlayerAvatar discordId={m.discordId} avatar={m.avatar} username={m.username ?? m.name} className="w-4 h-4" cdnSize={32} />
              {m.accountId === viewer.accountId ? "You" : m.name}
            </Link>
          );
        })}
      </nav>

      {view.league.status === "drafting" && (
        <p className="text-sm text-zinc-400 text-center">
          The draft is still running.{" "}
          <Link href={`/dashboard/fantasy/${leagueId}/draft`} className="text-indigo-300 hover:text-indigo-200 underline">
            Go to the draft room
          </Link>
        </p>
      )}

      <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-white">
            {shown ? (shown.accountId === viewer.accountId ? "Your roster" : `${shown.name}'s roster`) : "Roster"}
          </h2>
        </header>
        <ul className="divide-y divide-zinc-700/60">
          {LINEUP_SLOTS.map((slot, i) => (
            <li
              key={slot}
              className={`flex items-center gap-3 px-4 py-2.5 ${
                !isStarterSlot(slot) && isStarterSlot(LINEUP_SLOTS[i - 1]) ? "border-t-2 border-t-zinc-600" : ""
              }`}
            >
              <span
                className={`w-12 shrink-0 text-xs font-semibold uppercase tracking-wide ${
                  isStarterSlot(slot) ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                {SLOT_LABEL[slot]}
              </span>
              <SlotPlayer player={filled.get(slot)} empty={!filled.has(slot)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SlotPlayer({ player, empty }: { player: PoolPlayer | undefined; empty: boolean }) {
  if (empty) return <span className="text-sm text-zinc-500">Empty</span>;
  if (!player) return <span className="text-sm text-zinc-400">Unknown player</span>;
  return (
    <div className="flex flex-1 items-center gap-3 min-w-0">
      <PlayerAvatar discordId={player.discordId} avatar={player.avatar} username={player.username} className="w-8 h-8" cdnSize={64} />
      <div className="flex-1 min-w-0">
        <div className="flex whitespace-nowrap">
          <PlayerName displayName={player.name} username={player.username} discordId={player.discordId || null} className="text-sm text-white" />
        </div>
        <div className="text-xs text-zinc-400 truncate">
          {player.team ? (
            <TeamLink teamId={player.team.id} name={player.team.name} className="text-zinc-400">
              {player.team.name}
            </TeamLink>
          ) : (
            "Free agent"
          )}
        </div>
      </div>
      <TierBadge tier={player.tier} />
    </div>
  );
}
