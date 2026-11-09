import { Suspense } from "react";
import { getMatchupData } from "@/app/lib/fantasy-matchup-server";
import { getLeagueSummary } from "@/app/lib/fantasy-leagues";
import { lineupsFromEntries } from "@/app/lib/fantasy-season-end";
import { isFinalLeague } from "@/app/lib/fantasy-rules";
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
  const requestedWeek = q.week && /^\d+$/.test(q.week) ? Number(q.week) : null;

  if (isFinalLeague(view.league.status)) {
    // The matches these weeks scored from are gone, so an ended league draws
    // from the snapshot it took when the event ended, until the export drops it.
    const detail = (await getLeagueSummary(view.league.id))?.detail;
    const weeks = detail?.schedule.weeks ?? [];
    const week = weeks.find((w) => w.week === requestedWeek) ?? weeks[weeks.length - 1];
    if (!detail || !week) {
      return (
        <ComingSoon title="Matchup">
          The season is over. Final standings are on the League tab.
        </ComingSoon>
      );
    }
    return (
      <MatchupView
        schedule={detail.schedule}
        lineups={lineupsFromEntries(detail.lineups)}
        currentWeek={null}
        shownWeek={week}
        members={view.members}
        viewerId={viewer.accountId}
        focusManager={q.manager ?? null}
      />
    );
  }

  if (view.league.status !== "active") {
    return (
      <ComingSoon title="Matchup">
        Head-to-head matchups start once the league&apos;s draft is finished and the season is under way.
      </ComingSoon>
    );
  }

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
