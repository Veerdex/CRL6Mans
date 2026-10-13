// Everything about giving a match up that can be decided without Supabase or
// Discord. A pure leaf with no imports, so `node --test` can load it
// (`npm run test:forfeit-vote`) — same convention as series-report.ts.
//
// The wording of every refusal is surface-neutral, naming no command and no
// page, because My Team and `/forfeit` both show these strings verbatim — the
// same rule the four series cores follow.

// Two players have to agree. A forfeit ends the match for everyone on the
// roster, refunds every bet on it and advances the bracket, so one press must
// not be able to do it.
//
// The exceptions are both "there is nobody to agree with": a 1v1 team is one
// player by definition, and a 2v2 or 3v3 roster that has shrunk to one can't
// field a side at all — locking that player out of the one action that resolves
// a match they cannot play would leave the bracket waiting on the check-in
// sweeper instead.
export function forfeitVotesRequired(teamSize: number, rosterCount: number): number {
  if (teamSize === 1) return 1;
  return Math.min(2, Math.max(1, rosterCount));
}

// Minimal local shape rather than the `matches` row type: a leaf can't import
// one, and these are the only columns the decision reads.
export type ForfeitableMatch = {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  score_confirmed: boolean | null;
  pending_home_score: number | null;
  score_submitted_by_team_id: string | null;
};

// The same shape of guard as submissionBlocked, and deliberately not the same
// list. A forfeit needs an opponent to award the win to, so an unseated slot is
// refused here where reporting never reaches that state — and a pending
// submission blocks a forfeit outright rather than overriding it, because a
// score already in front of the other team has to be settled by the team that
// claimed it, not quietly replaced with a 0.
export function forfeitBlocked(m: ForfeitableMatch, teamId: string): string | null {
  if (!m.home_team_id || !m.away_team_id)
    return "This match doesn't have both teams yet.";
  if (m.home_team_id !== teamId && m.away_team_id !== teamId)
    return "This isn't your match.";
  if (m.home_score !== null || m.score_confirmed)
    return "This match is already final.";
  if (m.pending_home_score !== null && m.score_submitted_by_team_id !== null)
    return m.score_submitted_by_team_id === teamId
      ? "You've already reported a result for this series — retract it before giving the match up."
      : "The other team has reported a result for this series — approve or reject it instead.";
  return null;
}

// A forfeit is scored as the cleanest loss the series allows: the winning team
// takes exactly the games it needed and the forfeiting team none. Identical to
// what execDisqualifyTeam awards, so a team that gives one match up and a team
// disqualified out of the event leave the same shape of row behind.
export function forfeitScore(
  bestOf: number,
  forfeitingTeamIsHome: boolean,
): { homeScore: number; awayScore: number } {
  const winsNeeded = Math.ceil(bestOf / 2);
  return forfeitingTeamIsHome
    ? { homeScore: 0, awayScore: winsNeeded }
    : { homeScore: winsNeeded, awayScore: 0 };
}
