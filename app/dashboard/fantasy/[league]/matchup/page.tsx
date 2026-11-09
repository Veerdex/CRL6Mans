import { Suspense } from "react";
import { getMatchupData } from "@/app/lib/fantasy-matchup-server";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { ComingSoon } from "../coming-soon";
import { TabSkeleton } from "../tab-skeleton";
import { MatchupView } from "./matchup-view";

type Query = { week?: string; manager?: string };

export default function FantasyMatchupPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<Query>;
}) {
  return (
    <Suspense fallback={<TabSkeleton />}>
      <Matchup league={leagueFromParams(params)} query={searchParams} />
    </Suspense>
  );
}

async function Matchup({ league, query }: { league: Promise<LeagueAccess>; query: Promise<Query> }) {
  const [{ viewer, view }, q] = await Promise.all([league, query]);

  if (view.league.status !== "active") {
    return (
      <ComingSoon title="Matchup">
        Head-to-head matchups start once the league&apos;s draft is finished and the season is under way.
      </ComingSoon>
    );
  }

  const requestedWeek = q.week && /^\d+$/.test(q.week) ? Number(q.week) : null;
  const data = await getMatchupData(view.league.id, viewer.isStaff, requestedWeek);
  if (data.hiddenForTest) return <ComingSoon title="Matchup">Matchups open when the next season starts.</ComingSoon>;
  const week = data.schedule.weeks.find((w) => w.week === data.shownWeek);
  if (!week) {
    return <ComingSoon title="Matchup">This season has no group stage yet, so there are no fantasy weeks to play.</ComingSoon>;
  }

  return (
    <MatchupView
      schedule={data.schedule}
      lineups={data.lineups}
      currentWeek={data.currentWeek}
      shownWeek={week}
      members={view.members}
      viewerId={viewer.accountId}
      focusManager={q.manager ?? null}
    />
  );
}
