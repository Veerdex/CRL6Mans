import { test } from "node:test";
import assert from "node:assert/strict";

import {
  openMatchIds,
  seriesAwaitingTeam,
  subRequestsAwaitingTeam,
  type DecidableMatch,
  type PendingSubRow,
} from "../app/lib/decision-targets";

const MINE = "team-mine";
const THEIRS = "team-theirs";

const match = (over: Partial<DecidableMatch> & { id: string }): DecidableMatch => ({
  home_team_id: MINE,
  away_team_id: THEIRS,
  home_score: null,
  pending_home_score: null,
  pending_away_score: null,
  score_submitted_by_team_id: null,
  ...over,
});

// The fixture deliberately carries every shape the real table does — including
// the two rows a careless filter would wrongly return (our own submission, our
// own sub request) and the two it would wrongly keep (a finalised match, a
// submitted-then-finalised one). A fixture that omitted them would pass whether
// or not the narrowing existed.
const MATCHES: DecidableMatch[] = [
  match({ id: "m-nothing" }),
  match({ id: "m-theirs", pending_home_score: 2, pending_away_score: 1, score_submitted_by_team_id: THEIRS }),
  match({ id: "m-ours", pending_home_score: 3, pending_away_score: 0, score_submitted_by_team_id: MINE }),
  match({ id: "m-final", home_score: 2, pending_home_score: 2, pending_away_score: 1, score_submitted_by_team_id: THEIRS }),
  match({ id: "m-done", home_score: 0 }),
];

test("only the opposing team's submission is ours to decide", () => {
  const waiting = seriesAwaitingTeam(MATCHES, MINE);
  assert.deepEqual(waiting.map((m) => m.id), ["m-theirs"]);
});

test("the same rows read the other way round from the other bench", () => {
  // Symmetry is the point: whichever team submitted, exactly one side owes an
  // answer. A filter that tested truthiness instead of identity would hand both
  // rows to both teams.
  assert.deepEqual(seriesAwaitingTeam(MATCHES, THEIRS).map((m) => m.id), ["m-ours"]);
});

test("a submission on a finalised match is not waiting on anybody", () => {
  const stale = [match({
    id: "x", home_score: 2, pending_home_score: 2, pending_away_score: 1, score_submitted_by_team_id: THEIRS,
  })];
  assert.deepEqual(seriesAwaitingTeam(stale, MINE), []);
  assert.deepEqual(seriesAwaitingTeam(stale, THEIRS), []);
});

test("a null submitter is nobody's claim to answer", () => {
  // pending_home_score without a submitter shouldn't happen, but `!== teamId`
  // is true for null, so the strict null test is what keeps it out.
  const orphan = [match({ id: "x", pending_home_score: 1, pending_away_score: 0 })];
  assert.deepEqual(seriesAwaitingTeam(orphan, MINE), []);
});

test("a 0–0 pending score is still a pending score", () => {
  const nilNil = [match({
    id: "x", pending_home_score: 0, pending_away_score: 0, score_submitted_by_team_id: THEIRS,
  })];
  assert.deepEqual(seriesAwaitingTeam(nilNil, MINE).map((m) => m.id), ["x"]);
});

test("only unfinished matches are offered to the sub-request query", () => {
  assert.deepEqual(openMatchIds(MATCHES), ["m-nothing", "m-theirs", "m-ours"]);
});

test("a team cannot decide its own sub request", () => {
  const rows: PendingSubRow[] = [
    { id: "r-ours", team_id: MINE, match_id: "m-theirs" },
    { id: "r-theirs", team_id: THEIRS, match_id: "m-theirs" },
  ];
  assert.deepEqual(subRequestsAwaitingTeam(rows, MINE).map((r) => r.id), ["r-theirs"]);
  assert.deepEqual(subRequestsAwaitingTeam(rows, THEIRS).map((r) => r.id), ["r-ours"]);
});

test("nothing pending is an empty list, not a thrown error", () => {
  assert.deepEqual(seriesAwaitingTeam([], MINE), []);
  assert.deepEqual(subRequestsAwaitingTeam([], MINE), []);
  assert.deepEqual(openMatchIds([]), []);
});
