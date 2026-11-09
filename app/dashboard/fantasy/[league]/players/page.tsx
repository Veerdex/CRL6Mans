import { Suspense } from "react";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { managerLineup } from "@/app/lib/fantasy-lineup-server";
import { leagueWaiverPriority, managerPendingClaims } from "@/app/lib/fantasy-waivers-server";
import { cancelFrozenTrades, fantasyTradesEnabled, leagueReviews, managerTrades } from "@/app/lib/fantasy-trades-server";
import { isDirectorVerified } from "@/app/lib/players";
import { eliminatedInLeague } from "@/app/lib/fantasy-matchup-server";
import type { MemberView } from "@/app/lib/fantasy-leagues";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { WaiverOrder } from "../waiver-order";
import { ComingSoon } from "../coming-soon";
import { isFinalLeague } from "@/app/lib/fantasy-rules";
import { PoolSection, PoolSkeleton } from "./pool-section";
import { TrendingPlayers } from "./trending";
import type { RosterMoves } from "./move-action";
import { TradesToggle } from "./trades-toggle";

export default function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  const trades = fantasyTradesEnabled();
  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <Suspense fallback={<IntroText trades={false} />}>
        <Intro trades={trades} />
      </Suspense>
      <Suspense fallback={<PoolSkeleton />}>
        <Pool league={leagueFromParams(params)} trades={trades} />
      </Suspense>
    </div>
  );
}

async function Intro({ trades }: { trades: Promise<boolean> }) {
  return <IntroText trades={await trades} />;
}

function IntroText({ trades }: { trades: boolean }) {
  return (
    <p className="text-sm text-zinc-400 text-center">
      Every player in the season, as they come off the real draft. Add free agents and claim waivers here
      {trades ? ", and trade for another manager's players" : ""}.
    </p>
  );
}

async function Pool({ league, trades }: { league: Promise<LeagueAccess>; trades: Promise<boolean> }) {
  const { viewer, view } = await league;
  const leagueId = view.league.id;
  const [tradesEnabled, isDirector] = await Promise.all([
    trades,
    viewer.isStaff ? isDirectorVerified(viewer.discordId) : Promise.resolve(false),
  ]);
  if (isFinalLeague(view.league.status)) {
    return <ComingSoon title="Players">The season is over, so there are no more moves to make.</ComingSoon>;
  }
  const active = view.league.status === "active";
  const canMove = active && view.isMember && !!viewer.accountId;
  const priority = active ? leagueWaiverPriority(leagueId) : Promise.resolve([]);
  const pool = getPoolView(leagueId, viewer.isStaff);
  return (
    <div className="space-y-4">
      {isDirector && <TradesToggle enabled={tradesEnabled} />}
      <Suspense fallback={null}>
        <TrendingPlayers pool={pool} />
      </Suspense>
      {active && (
        <Suspense fallback={null}>
          <PriorityStrip priority={priority} members={view.members} viewerId={viewer.accountId} />
        </Suspense>
      )}
      <PoolSection
        pool={pool}
        moves={canMove ? rosterMoves(leagueId, view.league.fantasy_season_id, viewer.accountId!, priority, view.members, tradesEnabled) : null}
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
  tradesEnabled: boolean,
): Promise<RosterMoves> {
  // The run sweeps frozen trades daily; doing it here too means nobody is
  // shown an offer they can no longer accept.
  const trades = eliminatedInLeague(leagueId).then(async (eliminated) => {
    if (!tradesEnabled) return { eliminated, list: [], reviews: [] };
    await cancelFrozenTrades(leagueId, eliminated);
    const [list, reviews] = await Promise.all([managerTrades(leagueId, managerId), leagueReviews(leagueId, managerId)]);
    return { eliminated, list, reviews };
  });
  const [lineup, claims, order, { eliminated, list, reviews }] = await Promise.all([
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
    reviews,
    tradesEnabled,
    managerNames: Object.fromEntries(members.map((m) => [m.accountId, m.name])),
    lineup,
    claims: claims.map((c) => ({ id: c.id, playerId: c.playerId, dropPlayerId: c.dropPlayerId })),
    priority: spot >= 0 ? { spot: spot + 1, of: order.length } : null,
  };
}
