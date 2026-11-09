import { Suspense } from "react";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { managerLineup } from "@/app/lib/fantasy-lineup-server";
import { leagueWaiverPriority, managerPendingClaims } from "@/app/lib/fantasy-waivers-server";
import { managerTrades } from "@/app/lib/fantasy-trades-server";
import type { MemberView } from "@/app/lib/fantasy-leagues";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { WaiverOrder } from "../waiver-order";
import { PoolSection, PoolSkeleton } from "./pool-section";
import type { RosterMoves } from "./move-action";

export default function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <p className="text-sm text-zinc-400 text-center">
        Every player in the season, as they come off the real draft. Add free agents, claim waivers, and trade for
        another manager&apos;s players here.
      </p>
      <Suspense fallback={<PoolSkeleton />}>
        <Pool league={leagueFromParams(params)} />
      </Suspense>
    </div>
  );
}

async function Pool({ league }: { league: Promise<LeagueAccess> }) {
  const { viewer, view } = await league;
  const leagueId = view.league.id;
  const active = view.league.status === "active";
  const canMove = active && view.isMember && !!viewer.accountId;
  const priority = active ? leagueWaiverPriority(leagueId) : Promise.resolve([]);
  return (
    <div className="space-y-4">
      {active && (
        <Suspense fallback={null}>
          <PriorityStrip priority={priority} members={view.members} viewerId={viewer.accountId} />
        </Suspense>
      )}
      <PoolSection
        pool={getPoolView(leagueId, viewer.isStaff)}
        moves={canMove ? rosterMoves(leagueId, view.league.fantasy_season_id, viewer.accountId!, priority, view.members) : null}
      />
    </div>
  );
}

async function PriorityStrip({
  priority,
  members,
  viewerId,
}: {
  priority: Promise<string[]>;
  members: MemberView[];
  viewerId: string | null;
}) {
  return <WaiverOrder order={await priority} members={members} viewerId={viewerId} />;
}

async function rosterMoves(
  leagueId: string,
  fantasySeasonId: string,
  managerId: string,
  priority: Promise<string[]>,
  members: MemberView[],
): Promise<RosterMoves> {
  const [lineup, claims, order, trades] = await Promise.all([
    managerLineup(leagueId, fantasySeasonId, managerId),
    managerPendingClaims(leagueId, managerId),
    priority,
    managerTrades(leagueId, managerId),
  ]);
  const spot = order.indexOf(managerId);
  return {
    leagueId,
    managerId,
    managerNames: Object.fromEntries(members.map((m) => [m.accountId, m.name])),
    trades,
    lineup,
    claims: claims.map((c) => ({ id: c.id, playerId: c.playerId, dropPlayerId: c.dropPlayerId })),
    priority: spot >= 0 ? { spot: spot + 1, of: order.length } : null,
  };
}
