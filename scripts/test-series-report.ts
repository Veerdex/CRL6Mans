// Tests for app/lib/series-report.ts — the part of a Discord /report that can be
// decided without Supabase, Discord or a replay file.
//
// Run with: npm run test:series-report

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTypedScore,
  modeMismatch,
  replaySlotProblem,
  seriesShapeProblem,
  seriesScoreFrom,
  toHomeAway,
  submissionBlocked,
  type ReportableMatch,
  type TypedScore,
} from "../app/lib/series-report";

const err = (r: TypedScore | { error: string }): string => {
  assert.ok("error" in r, "expected a rejection, got a score");
  return r.error;
};

// Every validator answers `null` for "no problem", so a test that means to see a
// problem asserts one exists before matching on it — otherwise `assert.match`
// against null throws a type error rather than a readable failure.
const msg = (s: string | null): string => {
  assert.ok(s !== null, "expected a problem, got none");
  return s;
};

test("a missing score option is caught before its value is read", () => {
  // The whole point: optFrom answers "" for an absent option and Number("") is 0,
  // so without this `/report won:3` alone would submit a perfectly legal 3-0.
  assert.match(err(parseTypedScore(3, "")), /`lost` is missing/);
  assert.match(err(parseTypedScore("", 1)), /`won` is missing/);
  assert.match(err(parseTypedScore("", "")), /`won` and `lost` are/);

  assert.deepEqual(parseTypedScore(3, 1), { won: 3, lost: 1 });
  assert.deepEqual(parseTypedScore("3", "0"), { won: 3, lost: 0 });
  assert.deepEqual(parseTypedScore(0, 0), { won: 0, lost: 0 });
});

test("a score option that isn't a whole count is rejected", () => {
  assert.match(err(parseTypedScore(-1, 0)), /whole numbers/);
  assert.match(err(parseTypedScore(1.5, 0)), /whole numbers/);
  assert.match(err(parseTypedScore("three", 0)), /whole numbers/);
});

test("filling in the wrong half of the command is rejected, not ignored", () => {
  assert.match(
    msg(modeMismatch({ statsEnabled: true, typedScoreGiven: true, replayCount: 3 })),
    /read off the replays/,
  );
  assert.match(
    msg(modeMismatch({ statsEnabled: false, typedScoreGiven: true, replayCount: 2 })),
    /doesn't track stats/,
  );

  assert.equal(modeMismatch({ statsEnabled: true, typedScoreGiven: false, replayCount: 3 }), null);
  assert.equal(modeMismatch({ statsEnabled: false, typedScoreGiven: true, replayCount: 0 }), null);
  // Nothing supplied at all is a mode-appropriate problem, not a mismatch:
  // replaySlotProblem and parseTypedScore each answer for their own mode.
  assert.equal(modeMismatch({ statsEnabled: true, typedScoreGiven: false, replayCount: 0 }), null);
});

test("the replays have to be game1 upward with no gaps", () => {
  assert.match(msg(replaySlotProblem([], 5)), /starting with `game1`/);
  assert.match(msg(replaySlotProblem([2, 3], 5)), /Game 1 is missing/);
  assert.match(msg(replaySlotProblem([1, 3], 5)), /Game 2 is missing/);
  assert.match(msg(replaySlotProblem([1, 2, 4], 5)), /Game 3 is missing/);
  assert.match(msg(replaySlotProblem([1, 2, 3, 4], 3)), /4 replays for a best of 3/);

  assert.equal(replaySlotProblem([1], 1), null);
  assert.equal(replaySlotProblem([1, 2, 3], 5), null);
  assert.equal(replaySlotProblem([3, 1, 2], 5), null);
  assert.equal(replaySlotProblem([1, 2, 3, 4, 5, 6, 7], 7), null);
});

test("a series that was already decided can't have more games", () => {
  // The case validateSeriesScore can't see: three wins then two losses is 3-2,
  // a legal Bo5 scoreline, describing a series nobody played.
  assert.match(
    msg(seriesShapeProblem([true, true, true, false, false], 5)),
    /already decided at 3–0 before game 4/,
  );
  assert.match(
    msg(seriesShapeProblem([false, false, true], 3)),
    /already decided at 0–2 before game 3/,
  );
});

test("a series that nobody has won yet is incomplete, not wrong", () => {
  assert.match(msg(seriesShapeProblem([true, false], 5)), /add up to 1–1/);
  assert.match(msg(seriesShapeProblem([true, false], 5)), /3 wins are needed/);
  assert.match(msg(seriesShapeProblem([true], 3)), /doesn't finish a best of 3/);
});

test("a series played out legitimately passes", () => {
  assert.equal(seriesShapeProblem([true], 1), null);
  assert.equal(seriesShapeProblem([true, true], 3), null);
  assert.equal(seriesShapeProblem([true, false, true], 3), null);
  assert.equal(seriesShapeProblem([false, true, true, false, true], 5), null);
  assert.equal(seriesShapeProblem([true, true, true, true], 7), null);
});

test("the score comes off the game list, then maps onto home/away", () => {
  const games = [true, false, true, true];
  assert.deepEqual(seriesScoreFrom(games), { won: 3, lost: 1 });

  assert.deepEqual(toHomeAway({ won: 3, lost: 1 }, true), { homeWins: 3, awayWins: 1 });
  // The reporter being the away team is the whole reason this function exists:
  // the row stores home-first regardless of who ran the command.
  assert.deepEqual(toHomeAway({ won: 3, lost: 1 }, false), { homeWins: 1, awayWins: 3 });
});

const OPEN: ReportableMatch = {
  home_team_id: "home",
  away_team_id: "away",
  home_score: null,
  score_confirmed: null,
  pending_home_score: null,
  score_submitted_by_team_id: null,
};

test("only the two teams in the match can report it", () => {
  assert.equal(submissionBlocked(OPEN, "home"), null);
  assert.equal(submissionBlocked(OPEN, "away"), null);
  assert.match(msg(submissionBlocked(OPEN, "someone-else")), /isn't your match/);
});

test("a finished match can't be reported again", () => {
  assert.match(msg(submissionBlocked({ ...OPEN, home_score: 3 }, "home")), /already final/);
  assert.match(msg(submissionBlocked({ ...OPEN, score_confirmed: true }, "home")), /already final/);
});

test("a pending submission blocks both teams, each for its own reason", () => {
  const pending = { ...OPEN, pending_home_score: 3, score_submitted_by_team_id: "home" };

  // The submitter retracts rather than reporting over the top, matching the
  // website's WaitingView, which offers "Retract submission" and no resubmit.
  assert.match(msg(submissionBlocked(pending, "home")), /already reported/);
  assert.match(msg(submissionBlocked(pending, "home")), /Retract it/);

  // Without this branch the second team's report would overwrite the first
  // team's claim and then wait on that team to approve numbers it never sent.
  assert.match(msg(submissionBlocked(pending, "away")), /other team already reported/);
  assert.match(msg(submissionBlocked(pending, "away")), /approve or reject/);
});

test("the block wording names no command and no page, so both surfaces can show it", () => {
  // These strings are shown verbatim on the website and in Discord, like the ones
  // the sibling cores return. "Retract" is a button in one place and /reject in
  // the other, so naming either would be wrong on the other surface.
  const pending = { ...OPEN, pending_home_score: 3, score_submitted_by_team_id: "home" };
  for (const teamId of ["home", "away", "stranger"]) {
    const blocked = msg(submissionBlocked(pending, teamId));
    assert.ok(!blocked.includes("/"), blocked);
    assert.ok(!blocked.includes("My Team"), blocked);
  }
});

test("a retracted or rejected submission reopens reporting", () => {
  // cancelSeriesSubmission clears the pending fields, which is what makes a
  // resubmission-after-rejection work at all.
  assert.equal(
    submissionBlocked({ ...OPEN, pending_home_score: null, score_submitted_by_team_id: null }, "home"),
    null,
  );
});
