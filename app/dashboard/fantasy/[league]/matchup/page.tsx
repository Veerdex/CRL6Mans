import { loadLeague } from "../league-access";
import { ComingSoon } from "../coming-soon";

export default async function FantasyMatchupPage({ params }: { params: Promise<{ league: string }> }) {
  await loadLeague((await params).league);
  return <ComingSoon title="Matchup">This week&apos;s head-to-head matchups appear here once the season is under way.</ComingSoon>;
}
