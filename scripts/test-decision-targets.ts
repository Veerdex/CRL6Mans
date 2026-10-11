import { test } from "node:test";
import assert from "node:assert/strict";

import {
  openMatchIds,
  seriesAwaitingTeam,
  subRequestsAwaitingTeam,
  seriesDisputableByTeam,
  subRequestsDisputableByTeam,
  type DecidableMatch,
  type PendingSubRow,
  type DisputableMatch,
  type DisputableSubRow,
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

// ── Disputes: the inverse narrowing ───────────────────────────────────────────

const ELSEWHERE = "team-elsewhere";

const disputable = (over: Partial<DisputableMatch> & { id: string }): DisputableMatch => ({
  home_team_id: MINE,
  away_team_id: THEIRS,
  home_score: null,
  pending_home_score: null,
  score_rejected_by_team_id: null,
  score_rejected_home: null,
  score_rejected_away: null,
  score_disputed_at: null,
  ...over,
});

const REJECTED: DisputableMatch[] = [
  // Ours to dispute: we submitted, they threw it out, nobody has escalated.
  disputable({ id: "d-theirs", score_rejected_by_team_id: THEIRS, score_rejected_home: 2, score_rejected_away: 1 }),
  // Theirs to dispute, not ours — we are the ones who rejected.
  disputable({ id: "d-ours", score_rejected_by_team_id: MINE, score_rejected_home: 3, score_rejected_away: 0 }),
  // Already with staff. Offering it again would push them a second time.
  disputable({ id: "d-escalated", score_rejected_by_team_id: THEIRS, score_rejected_home: 2, score_rejected_away: 1, score_disputed_at: "2026-10-11T00:00:00Z" }),
  // Resubmitted after the rejection: the new claim has its own round to go
  // through, and submitSeriesResult should have cleared these columns anyway.
  disputable({ id: "d-resubmitted", score_rejected_by_team_id: THEIRS, score_rejected_home: 2, score_rejected_away: 1, pending_home_score: 1 }),
  // Staff already recorded a result, so there is nothing left to argue about.
  disputable({ id: "d-final", home_score: 2, score_rejected_by_team_id: THEIRS, score_rejected_home: 2, score_rejected_away: 1 }),
  // A rejection with no rejecter can't have been anyone's, and `!== teamId` is
  // true for null — the strict null test is what keeps it out.
  disputable({ id: "d-orphan", score_rejected_home: 2, score_rejected_away: 1 }),
  // Two other teams' match. This is the row the inversion gets wrong without a
  // membership test: `score_rejected_by_team_id !== MINE` is true here.
  disputable({ id: "d-elsewhere", home_team_id: THEIRS, away_team_id: ELSEWHERE, score_rejected_by_team_id: THEIRS, score_rejected_home: 2, score_rejected_away: 1 }),
];

test("only our own rejected submission is ours to dispute", () => {
  assert.deepEqual(seriesDisputableByTeam(REJECTED, MINE).map((m) => m.id), ["d-theirs"]);
});

test("dispute reads the other way round from the other bench", () => {
  // d-elsewhere is THEIRS' match too, and THEIRS rejected it, so it stays out
  // for them on the rejecter test rather than on membership.
  assert.deepEqual(seriesDisputableByTeam(REJECTED, THEIRS).map((m) => m.id), ["d-ours"]);
});

test("dispute is the inverse of a decision, not the same filter", () => {
  // The whole reason both live here: the row we owe an answer on and the row we
  // can escalate are never the same row.
  const submitted = match({
    id: "x", pending_home_score: 2, pending_away_score: 1, score_submitted_by_team_id: THEIRS,
  });
  const rejected = disputable({ id: "x", score_rejected_by_team_id: THEIRS });
  assert.deepEqual(seriesAwaitingTeam([submitted], MINE).map((m) => m.id), ["x"]);
  assert.deepEqual(seriesDisputableByTeam([rejected], MINE).map((m) => m.id), ["x"]);
  assert.deepEqual(seriesAwaitingTeam([submitted], THEIRS), []);
  assert.deepEqual(seriesDisputableByTeam([rejected], THEIRS), []);
});

test("a 0–0 rejected score is still a rejected score", () => {
  const nilNil = [disputable({
    id: "x", score_rejected_by_team_id: THEIRS, score_rejected_home: 0, score_rejected_away: 0,
  })];
  assert.deepEqual(seriesDisputableByTeam(nilNil, MINE).map((m) => m.id), ["x"]);
});

test("only our own rejected sub request is ours to dispute", () => {
  const rows: DisputableSubRow[] = [
    { id: "r-ours", team_id: MINE, match_id: "m", status: "rejected" },
    { id: "r-theirs", team_id: THEIRS, match_id: "m", status: "rejected" },
    { id: "r-pending", team_id: MINE, match_id: "m", status: "pending" },
    { id: "r-escalated", team_id: MINE, match_id: "m", status: "escalated" },
    { id: "r-approved", team_id: MINE, match_id: "m", status: "approved" },
  ];
  assert.deepEqual(subRequestsDisputableByTeam(rows, MINE).map((r) => r.id), ["r-ours"]);
  assert.deepEqual(subRequestsDisputableByTeam(rows, THEIRS).map((r) => r.id), ["r-theirs"]);
});

test("nothing rejected is an empty list, not a thrown error", () => {
  assert.deepEqual(seriesDisputableByTeam([], MINE), []);
  assert.deepEqual(subRequestsDisputableByTeam([], MINE), []);
});
