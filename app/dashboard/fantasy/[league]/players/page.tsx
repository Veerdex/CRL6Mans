import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { loadLeague } from "../league-access";
import { PoolTable } from "./pool-table";

export default async function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  const { viewer, view } = await loadLeague((await params).league);
  const pool = await getPoolView(view.league.id, viewer.isStaff);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <p className="text-sm text-zinc-400 text-center">Every player in the season, as they come off the real draft.</p>

      {pool.players.length > 0 ? (
        <PoolTable players={pool.players} />
      ) : (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 text-sm text-zinc-300 text-center">
          {pool.hiddenForTest
            ? "The player pool opens when the next season starts."
            : "No players yet. The pool fills as players are drafted onto teams."}
        </div>
      )}
    </div>
  );
}
