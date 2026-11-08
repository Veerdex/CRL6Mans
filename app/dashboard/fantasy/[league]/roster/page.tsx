import { Suspense } from "react";
import Link from "next/link";
import { getPoolView, type PoolPlayer } from "@/app/lib/fantasy-pool-data";
import { rosterSlots } from "@/app/lib/fantasy-draft-server";
import { LINEUP_SLOTS, SLOT_LABEL, isStarterSlot, slotTier, type LineupSlot } from "@/app/lib/fantasy-draft";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { TeamLink } from "@/app/dashboard/team-link";
import { leagueFromParams, type LeagueAccess } from "../league-access";
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
      <div className="max-w-3xl mx-auto space-y-4">
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-2 text-sm text-zinc-300">
          <h2 className="font-semibold text-white">
            {view.isMember ? "This is where your team will live" : "This is where each manager's team will live"}
          </h2>
          <p>
            In the fantasy draft every manager picks <strong className="text-white">8 players</strong>: 2 from Tier 1,
            3 from Tier 2 and 3 from Tier 3. Each pick drops into the first open slot it fits, so the lineup below fills
            in as the draft runs.
          </p>
          <p>
            <strong className="text-white">Six start and score points</strong>: your Cap (Tier 1), two 1sts (Tier 2),
            two 2nds (Tier 3) and a Flex that takes any tier. The <strong className="text-white">two on the bench</strong>{" "}
            score nothing until you move them into the lineup, so they&apos;re your cover when a starter can&apos;t play.
          </p>
          <p className="text-zinc-400">
            Tier limits last all season: any player you add later has to replace one from the same tier.{" "}
            <Link href={`/dashboard/fantasy/${leagueId}/players`} className="text-indigo-300 hover:text-indigo-200 underline">
              Browse the player pool
            </Link>{" "}
            to plan your picks.
          </p>
        </section>
        <RosterTable title={view.isMember ? "Your roster" : "Roster"} filled={new Map()} />
      </div>
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

      <RosterTable
        title={shown ? (shown.accountId === viewer.accountId ? "Your roster" : `${shown.name}'s roster`) : "Roster"}
        filled={filled}
      />
    </div>
  );
}

function slotHint(slot: LineupSlot): string {
  const tier = slotTier(slot);
  if (tier) return `Tier ${tier}`;
  return isStarterSlot(slot) ? "Any tier" : "Bench · any tier";
}

function RosterTable({ title, filled }: { title: string; filled: Map<LineupSlot, PoolPlayer | undefined> }) {
  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-700">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
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
            <SlotPlayer player={filled.get(slot)} empty={!filled.has(slot)} hint={slotHint(slot)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SlotPlayer({ player, empty, hint }: { player: PoolPlayer | undefined; empty: boolean; hint: string }) {
  if (empty) {
    return (
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-full border border-dashed border-zinc-600" aria-hidden />
        <span className="text-sm text-zinc-500">Empty · {hint}</span>
      </div>
    );
  }
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
