// Everything about a `/report` that can be decided without Supabase, Discord or
// a replay file. A pure leaf with no imports, so `node --test` can load it
// (`npm run test:series-report`) — same convention as draft-order.ts.
//
// Reporter-relative throughout. The team running the command knows what it won
// and lost; home/away is a property of the match row, so the mapping happens
// once, at the end, in `toHomeAway`.

export type TypedScore = { won: number; lost: number };

// A Discord option that wasn't supplied reads back as "", and `Number("")` is 0
// — so `/report won:3` with `lost` forgotten would submit a legal-looking 3–0.
// Presence has to be established before the value is read, which is why this
// takes the raw option values rather than numbers.
export function parseTypedScore(
  won: string | number | boolean,
  lost: string | number | boolean,
): TypedScore | { error: string } {
  const missing = [
    won === "" || won === undefined ? "`won`" : null,
    lost === "" || lost === undefined ? "`lost`" : null,
  ].filter((s): s is string => s !== null);
  if (missing.length > 0)
    return { error: `Give both game counts — ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.` };

  const w = Number(won);
  const l = Number(lost);
  if (!Number.isInteger(w) || !Number.isInteger(l) || w < 0 || l < 0)
    return { error: "Game wins have to be whole numbers, zero or more." };
  return { won: w, lost: l };
}

// Discord can't make an option conditionally required — required options have to
// come first and `stats_enabled` isn't knowable at registration time — so every
// `/report` option is optional and the wrong half being filled in is caught here.
// Rejecting rather than ignoring the extra: a typed 3–1 silently discarded in
// favour of a 3–2 read off the replays is the kind of thing nobody notices until
// the standings are wrong.
export function modeMismatch(args: {
  statsEnabled: boolean;
  typedScoreGiven: boolean;
  replayCount: number;
}): string | null {
  if (args.statsEnabled && args.typedScoreGiven)
    return "This event tracks stats, so the score is read off the replays — attach the games and leave `won`/`lost` out.";
  if (!args.statsEnabled && args.replayCount > 0)
    return "This event doesn't track stats, so replays aren't recorded — report the series with `won` and `lost` instead.";
  return null;
}

// The replays have to describe one series from game 1 up, with nothing skipped:
// a gap means a game went unreported, and the score derived from what's left
// would be wrong rather than incomplete.
export function replaySlotProblem(gameNumbers: number[], bestOf: number): string | null {
  if (gameNumbers.length === 0)
    return "Attach the series' replays, starting with `game1`.";

  const sorted = [...gameNumbers].sort((a, b) => a - b);
  const gap = sorted.findIndex((n, i) => n !== i + 1);
  if (gap !== -1)
    return `Game ${gap + 1} is missing — attach every game of the series starting at \`game1\`, with no gaps.`;

  if (sorted.length > bestOf)
    return `That's ${sorted.length} replays for a best of ${bestOf}.`;
  return null;
}

// A list of game winners only describes a series anyone played if it stopped the
// moment one side clinched. A Bo5 whose first three games went to the reporter
// and whose last two went to the opponent reads as 3–2, which `validateSeriesScore`
// happily accepts — this is the check that catches it.
export function seriesShapeProblem(wonByReporter: boolean[], bestOf: number): string | null {
  const needed = Math.ceil(bestOf / 2);
  let won = 0;
  let lost = 0;

  for (let i = 0; i < wonByReporter.length; i++) {
    if (won >= needed || lost >= needed)
      return (
        `The series was already decided at ${won}–${lost} before game ${i + 1} — ` +
        `a best of ${bestOf} ends at ${needed} wins.`
      );
    if (wonByReporter[i]) won++;
    else lost++;
  }

  if (won < needed && lost < needed)
    return (
      `These replays add up to ${won}–${lost}, which doesn't finish a best of ${bestOf} — ` +
      `${needed} wins are needed.`
    );
  return null;
}

export function seriesScoreFrom(wonByReporter: boolean[]): TypedScore {
  return {
    won: wonByReporter.filter((w) => w).length,
    lost: wonByReporter.filter((w) => !w).length,
  };
}

export function toHomeAway(
  score: TypedScore,
  reporterIsHome: boolean,
): { homeWins: number; awayWins: number } {
  return reporterIsHome
    ? { homeWins: score.won, awayWins: score.lost }
    : { homeWins: score.lost, awayWins: score.won };
}

// Minimal local shape rather than the `matches` row type: a leaf can't import
// one, and these are the only columns the decision reads.
export type ReportableMatch = {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  score_confirmed: boolean | null;
  pending_home_score: number | null;
  score_submitted_by_team_id: string | null;
};

// Whether a team may submit at all. The website's panel swaps the report form
// for a confirm-or-retract view once something is pending, so this guard has
// never had to exist there — on Discord nothing stops either team from typing
// the command, and without it a second report would silently overwrite the
// first team's claim and then sit there waiting for that team to approve
// numbers it never submitted.
//
// It blocks the submitter too, matching the website: WaitingView offers
// "Retract submission", not a resubmit, so a correction goes through a retraction
// rather than over the top of the pending row.
//
// The wording names no command and no page. Both surfaces show these strings
// verbatim, the same way confirmSeriesResultCore's do, and a retraction is a
// button on the website and a /reject on Discord.
export function submissionBlocked(m: ReportableMatch, teamId: string): string | null {
  if (m.home_team_id !== teamId && m.away_team_id !== teamId)
    return "This isn't your match.";
  if (m.home_score !== null || m.score_confirmed)
    return "This match is already final.";
  if (m.pending_home_score !== null && m.score_submitted_by_team_id !== null)
    return m.score_submitted_by_team_id === teamId
      ? "You've already reported this series — the other team has to approve it. Retract it first if the score was wrong."
      : "The other team already reported this series — approve or reject it instead.";
  return null;
}
