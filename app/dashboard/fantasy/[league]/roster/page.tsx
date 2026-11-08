import { loadLeague } from "../league-access";
import { ComingSoon } from "../coming-soon";

export default async function FantasyRosterPage({ params }: { params: Promise<{ league: string }> }) {
  const { view } = await loadLeague((await params).league);
  return (
    <ComingSoon title="Roster">
      {view.isMember
        ? "Your lineup appears here once the fantasy draft runs."
        : "Each manager's lineup appears here once the fantasy draft runs."}
    </ComingSoon>
  );
}
