import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { fantasyAccessOpen, getFantasyViewer, getLeagueView } from "@/app/lib/fantasy-leagues";
import { getPoolView } from "@/app/lib/fantasy-pool-data";
import { PoolTable } from "./pool-table";

export default async function FantasyPlayerPoolPage({ params }: { params: Promise<{ league: string }> }) {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) redirect("/login");
  const viewer = await getFantasyViewer(session.userId);
  if (viewer.isGuest) redirect("/dashboard");
  if (!(await fantasyAccessOpen(viewer))) redirect("/dashboard/fantasy");

  const { league: leagueId } = await params;
  const view = await getLeagueView(leagueId, viewer);
  if (!view || view.league.status === "disbanded") notFound();
  const pool = await getPoolView(view.league.id, viewer.isStaff);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <Link
        href={`/dashboard/fantasy/${view.league.id}`}
        className="inline-flex items-center gap-1.5 min-h-10 rounded-full bg-zinc-800 border border-zinc-700 pl-3 pr-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-4 h-4">
          <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
        </svg>
        {view.league.name}
      </Link>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Player Pool</h1>
        <p className="text-sm text-zinc-400 mt-1">Every player in the season, as they come off the real draft.</p>
      </div>

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
