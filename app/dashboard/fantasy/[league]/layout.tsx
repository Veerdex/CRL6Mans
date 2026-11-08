import Link from "next/link";
import { loadLeague } from "./league-access";
import { LeagueTabs } from "./league-tabs";

export default async function FantasyLeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ league: string }>;
}) {
  const { league: leagueId } = await params;
  const { view } = await loadLeague(leagueId);

  return (
    <div>
      <LeagueTabs leagueId={view.league.id} />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="max-w-6xl mx-auto space-y-4">
          <Link
            href="/dashboard/fantasy?tab=all"
            className="inline-flex items-center gap-1.5 min-h-10 rounded-full bg-zinc-800 border border-zinc-700 pl-3 pr-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-4 h-4">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
            </svg>
            All Leagues
          </Link>
          <h1 className="text-2xl font-bold text-white text-center break-words">{view.league.name}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
