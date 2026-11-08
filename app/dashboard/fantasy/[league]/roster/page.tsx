import { Suspense } from "react";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { ComingSoon } from "../coming-soon";
import { TabSkeleton } from "../tab-skeleton";

export default function FantasyRosterPage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <Suspense fallback={<TabSkeleton />}>
      <Roster league={leagueFromParams(params)} />
    </Suspense>
  );
}

async function Roster({ league }: { league: Promise<LeagueAccess> }) {
  const { view } = await league;
  return (
    <ComingSoon title="Roster">
      {view.isMember
        ? "Your lineup appears here once the fantasy draft runs."
        : "Each manager's lineup appears here once the fantasy draft runs."}
    </ComingSoon>
  );
}
