import { Suspense } from "react";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { managerLineup } from "@/app/lib/fantasy-lineup-server";
import { leagueWaiverPriority, managerPendingClaims } from "@/app/lib/fantasy-waivers-server";
import { cancelFrozenTrades, managerTrades } from "@/app/lib/fantasy-trades-server";
import { eliminatedInLeague } from "@/app/lib/fantasy-matchup-server";
import type { MemberView } from "@/app/lib/fantasy-leagues";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { WaiverOrder } from "../waiver-order";
import { ComingSoon } from "../coming-soon";
import { FANTASY_TRADES_ENABLED, isFinalLeague } from "@/app/lib/fantasy-rules";
import { PoolSection, PoolSkeleton } from "./pool-section";
import type { RosterMoves } from "./move-action";

export default function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <p className="text-sm text-zinc-400 text-center">
        Every player in the season, as they come off the real draft. Add free agents and claim waivers here
        {FANTASY_TRADES_ENABLED ? ", and trade for another manager's players" : ""}.
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
  if (isFinalLeague(view.league.status)) {
    return <ComingSoon title="Players">The season is over, so there are no more moves to make.</ComingSoon>;
  }
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
  // The run sweeps frozen trades daily; doing it here too means nobody is
  // shown an offer they can no longer accept.
  const trades = eliminatedInLeague(leagueId).then(async (eliminated) => {
    if (!FANTASY_TRADES_ENABLED) return { eliminated, list: [] };
    await cancelFrozenTrades(leagueId, eliminated);
    return { eliminated, list: await managerTrades(leagueId, managerId) };
  });
  const [lineup, claims, order, { eliminated, list }] = await Promise.all([
    managerLineup(leagueId, fantasySeasonId, managerId),
    managerPendingClaims(leagueId, managerId),
    priority,
    trades,
  ]);
  const spot = order.indexOf(managerId);
  return {
    leagueId,
    managerId,
    eliminated: [...eliminated],
    trades: list,
    managerNames: Object.fromEntries(members.map((m) => [m.accountId, m.name])),
    lineup,
    claims: claims.map((c) => ({ id: c.id, playerId: c.playerId, dropPlayerId: c.dropPlayerId })),
    priority: spot >= 0 ? { spot: spot + 1, of: order.length } : null,
  };
}
