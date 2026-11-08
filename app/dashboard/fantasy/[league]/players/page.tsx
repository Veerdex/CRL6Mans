import { Suspense } from "react";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { loadLeague } from "../league-access";
import { PoolSection, PoolSkeleton } from "./pool-section";

export default async function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  const { viewer, view } = await loadLeague((await params).league);
  // Not awaited: the page sends straight away and the table streams in when the pool resolves.
  const pool = getPoolView(view.league.id, viewer.isStaff);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <p className="text-sm text-zinc-400 text-center">Every player in the season, as they come off the real draft.</p>
      <Suspense fallback={<PoolSkeleton />}>
        <PoolSection pool={pool} />
      </Suspense>
    </div>
  );
}
