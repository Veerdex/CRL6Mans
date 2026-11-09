import { Suspense } from "react";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { managerLineup } from "@/app/lib/fantasy-lineup-server";
import { managerPendingClaims } from "@/app/lib/fantasy-waivers-server";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { PoolSection, PoolSkeleton } from "./pool-section";
import type { RosterMoves } from "./move-action";

export default function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <p className="text-sm text-zinc-400 text-center">Every player in the season, as they come off the real draft.</p>
      <Suspense fallback={<PoolSkeleton />}>
        <Pool league={leagueFromParams(params)} />
      </Suspense>
    </div>
  );
}

async function Pool({ league }: { league: Promise<LeagueAccess> }) {
  const { viewer, view } = await league;
  const leagueId = view.league.id;
  const canMove = view.league.status === "active" && view.isMember && !!viewer.accountId;
  return (
    <PoolSection
      pool={getPoolView(leagueId, viewer.isStaff)}
      moves={canMove ? rosterMoves(leagueId, view.league.fantasy_season_id, viewer.accountId!) : null}
    />
  );
}

async function rosterMoves(leagueId: string, fantasySeasonId: string, managerId: string): Promise<RosterMoves> {
  const [lineup, claims] = await Promise.all([
    managerLineup(leagueId, fantasySeasonId, managerId),
    managerPendingClaims(leagueId, managerId),
  ]);
  return {
    leagueId,
    lineup,
    claims: claims.map((c) => ({ id: c.id, playerId: c.playerId, dropPlayerId: c.dropPlayerId })),
  };
}
