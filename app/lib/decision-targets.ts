// Which pending decision /approve and /reject are actually about.
//
// A pure leaf with no imports, so `node --test` can load it. The filters live
// here rather than inline in the bot because they encode the one rule that has
// no type to protect it: a decision is yours only when the *other* side made the
// claim. The website's cancelSeriesSubmission deliberately lets either team
// retract a pending score, and acceptSubRequest's own guard is "is this request
// still pending", not "is it mine" — so if this narrowing were skipped, a player
// could run `/reject series` and silently undo their own team's submission, or
// `/approve sub` their own team's substitute. Nothing downstream would complain.

export type DecidableMatch = {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  pending_home_score: number | null;
  pending_away_score: number | null;
  score_submitted_by_team_id: string | null;
};

export type PendingSubRow = { id: string; team_id: string; match_id: string };

/** Unfinished matches, which is the only set either decision can apply to. */
export function openMatchIds(matches: DecidableMatch[]): string[] {
  return matches.filter((m) => m.home_score === null).map((m) => m.id);
}

/**
 * Series results this team has to answer for: submitted, not yet final, and
 * submitted by somebody else. A null submitter can't be the other team, so the
 * `!==` comparison is deliberately strict rather than a truthiness check.
 */
export function seriesAwaitingTeam(matches: DecidableMatch[], teamId: string): DecidableMatch[] {
  return matches.filter(
    (m) =>
      m.pending_home_score !== null &&
      m.home_score === null &&
      m.score_submitted_by_team_id !== null &&
      m.score_submitted_by_team_id !== teamId,
  );
}

/**
 * Sub requests this team has to answer for. `rows` is already filtered to
 * status "pending" and to open matches by the query; what's left is dropping
 * the team's own requests, which it has no standing to accept or reject.
 */
export function subRequestsAwaitingTeam(rows: PendingSubRow[], teamId: string): PendingSubRow[] {
  return rows.filter((r) => r.team_id !== teamId);
}
