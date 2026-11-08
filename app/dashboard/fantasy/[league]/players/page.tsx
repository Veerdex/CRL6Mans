import { Suspense } from "react";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { PoolSection, PoolSkeleton } from "./pool-section";

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
  return <PoolSection pool={getPoolView(view.league.id, viewer.isStaff)} />;
}
