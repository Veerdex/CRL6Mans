// Which pending decision /approve, /reject and /dispute are actually about.
//
// A pure leaf with no imports, so `node --test` can load it. The filters live
// here rather than inline in the bot because they encode the one rule that has
// no type to protect it: a decision is yours only when the *other* side made the
// claim. The website's cancelSeriesSubmission deliberately lets either team
// retract a pending score, and acceptSubRequest's own guard is "is this request
// still pending", not "is it mine" — so if this narrowing were skipped, a player
// could run `/reject series` and silently undo their own team's submission, or
// `/approve sub` their own team's substitute. Nothing downstream would complain.
//
// **A dispute inverts that rule.** It is yours when *you* made the claim and the
// other side threw it out, so the disputable filters compare the other way
// round: `score_rejected_by_team_id !== mine` for a series, `team_id === mine`
// for a sub request — the exact opposite of subRequestsAwaitingTeam. Both cores
// re-check standing themselves, so a wrong filter here would not let anyone
// escalate someone else's claim; it would offer them a target the core then
// refuses, which reads as the command being broken.

export type DecidableMatch = {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  // Carried so the row satisfies series-report.ts's ReportableMatch, which
  // submissionBlocked reads — /report scopes a match with these same rows.
  score_confirmed: boolean | null;
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
 * Matches this team could report a result for: unfinished, with nothing pending.
 *
 * The mirror image of seriesAwaitingTeam, and the narrowing /report picks a match
 * with. It is only a target filter — submissionBlocked in series-report.ts is the
 * guard, and submitSeriesResultCore runs it on the row it actually writes to.
 * Membership isn't checked here because the caller has already scoped the rows to
 * this team's matches, exactly as the sub filters assume.
 */
export function seriesReportableByTeam(matches: DecidableMatch[]): DecidableMatch[] {
  return matches.filter((m) => m.home_score === null && m.pending_home_score === null);
}

/**
 * Sub requests this team has to answer for. `rows` is already filtered to
 * status "pending" and to open matches by the query; what's left is dropping
 * the team's own requests, which it has no standing to accept or reject.
 */
export function subRequestsAwaitingTeam(rows: PendingSubRow[], teamId: string): PendingSubRow[] {
  return rows.filter((r) => r.team_id !== teamId);
}

export type DisputableMatch = {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  pending_home_score: number | null;
  score_rejected_by_team_id: string | null;
  score_rejected_home: number | null;
  score_rejected_away: number | null;
  score_disputed_at: string | null;
};

export type DisputableSubRow = { id: string; team_id: string; match_id: string; status: string };

/**
 * Series results this team submitted and the other team threw out.
 *
 * Mirrors disputeSeriesResultCore's guards, in its order: something was
 * rejected, somebody else rejected it, nobody has escalated it yet, the match
 * is unfinished, and no resubmission has superseded the rejection (a new claim
 * gets its own confirm/reject round, and submitSeriesResult clears these
 * columns when it lands — this is the belt to that braces).
 *
 * The participant check is load-bearing here in a way it is not in
 * seriesAwaitingTeam: `score_rejected_by_team_id !== teamId` is trivially true
 * for every match this team is not in, so the inverted comparison needs the
 * membership test beside it rather than relying on the caller's scoping.
 */
export function seriesDisputableByTeam(matches: DisputableMatch[], teamId: string): DisputableMatch[] {
  return matches.filter(
    (m) =>
      (m.home_team_id === teamId || m.away_team_id === teamId) &&
      m.score_rejected_by_team_id !== null &&
      m.score_rejected_by_team_id !== teamId &&
      m.score_disputed_at === null &&
      m.home_score === null &&
      m.pending_home_score === null,
  );
}

/**
 * Sub requests this team made and the other team threw out. `status` is filtered
 * here rather than in the query so that "already escalated" is a case the tests
 * can state: an escalated request is still this team's rejected request as far
 * as `team_id` is concerned, and offering it again would push staff twice.
 */
export function subRequestsDisputableByTeam(rows: DisputableSubRow[], teamId: string): DisputableSubRow[] {
  return rows.filter((r) => r.team_id === teamId && r.status === "rejected");
}
