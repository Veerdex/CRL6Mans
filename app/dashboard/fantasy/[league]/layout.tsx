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
        <h1 className="max-w-6xl mx-auto text-2xl font-bold text-white text-center break-words">{view.league.name}</h1>
        {children}
      </div>
    </div>
  );
}
