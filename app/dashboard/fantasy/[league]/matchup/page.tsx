import { Suspense } from "react";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { ComingSoon } from "../coming-soon";
import { TabSkeleton } from "../tab-skeleton";

export default function FantasyMatchupPage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <Suspense fallback={<TabSkeleton />}>
      <Matchup league={leagueFromParams(params)} />
    </Suspense>
  );
}

async function Matchup({ league }: { league: Promise<LeagueAccess> }) {
  await league;
  return <ComingSoon title="Matchup">This week&apos;s head-to-head matchups appear here once the season is under way.</ComingSoon>;
}
