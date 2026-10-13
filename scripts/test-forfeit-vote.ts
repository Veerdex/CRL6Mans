import { test } from "node:test";
import assert from "node:assert/strict";

import {
  forfeitVotesRequired,
  forfeitBlocked,
  forfeitScore,
  type ForfeitableMatch,
} from "../app/lib/forfeit-vote";

const HOME = "home-team";
const AWAY = "away-team";

const open = (over: Partial<ForfeitableMatch> = {}): ForfeitableMatch => ({
  home_team_id: HOME,
  away_team_id: AWAY,
  home_score: null,
  score_confirmed: false,
  pending_home_score: null,
  score_submitted_by_team_id: null,
  ...over,
});

// ─── How many presses it takes ──────────────────────────────────────────────────

test("a 2v2 or 3v3 team needs two players to agree", () => {
  assert.equal(forfeitVotesRequired(2, 2), 2);
  assert.equal(forfeitVotesRequired(3, 3), 2);
  // A 3v3 roster one player short still has two players to agree.
  assert.equal(forfeitVotesRequired(3, 2), 2);
});

test("a 1v1 team forfeits on one press, because there is nobody to agree with", () => {
  assert.equal(forfeitVotesRequired(1, 1), 1);
});

test("the last player on a team decides alone rather than being locked out", () => {
  assert.equal(forfeitVotesRequired(3, 1), 1);
  assert.equal(forfeitVotesRequired(2, 1), 1);
});

// An empty roster can't produce a vote either, so the floor exists to keep the
// threshold meaningful rather than to let nobody forfeit: a required of 0 would
// read as already satisfied.
test("the threshold never drops to zero", () => {
  assert.equal(forfeitVotesRequired(3, 0), 1);
  assert.equal(forfeitVotesRequired(1, 0), 1);
});

// ─── What stops a forfeit ───────────────────────────────────────────────────────

test("either team in a seated, unplayed match may forfeit it", () => {
  assert.equal(forfeitBlocked(open(), HOME), null);
  assert.equal(forfeitBlocked(open(), AWAY), null);
});

test("a match missing an opponent has nobody to award the win to", () => {
  assert.match(forfeitBlocked(open({ away_team_id: null }), HOME)!, /both teams/i);
});

test("a team not in the match is refused", () => {
  assert.match(forfeitBlocked(open(), "someone-else")!, /isn't your match/i);
});

test("a finalised match can't be forfeited", () => {
  assert.match(forfeitBlocked(open({ home_score: 3 }), HOME)!, /already final/i);
  assert.match(forfeitBlocked(open({ score_confirmed: true }), HOME)!, /already final/i);
});

test("a pending submission has to be settled first, and each team is told its own half", () => {
  const pending = open({ pending_home_score: 3, score_submitted_by_team_id: HOME });
  assert.match(forfeitBlocked(pending, HOME)!, /retract/i);
  assert.match(forfeitBlocked(pending, AWAY)!, /approve or reject/i);
});

// Both surfaces print these verbatim, so one naming a button or a slash command
// would be wrong on the other.
test("no refusal names a command or a page", () => {
  const messages = [
    forfeitBlocked(open({ away_team_id: null }), HOME),
    forfeitBlocked(open(), "someone-else"),
    forfeitBlocked(open({ home_score: 3 }), HOME),
    forfeitBlocked(open({ pending_home_score: 3, score_submitted_by_team_id: HOME }), HOME),
    forfeitBlocked(open({ pending_home_score: 3, score_submitted_by_team_id: AWAY }), HOME),
  ].filter((m): m is string => m !== null);

  assert.equal(messages.length, 5);
  for (const m of messages) {
    assert.ok(!m.includes("/"), `names a command: ${m}`);
    assert.ok(!/my team|website|discord|button/i.test(m), `names a surface: ${m}`);
  }
});

// ─── The score it records ───────────────────────────────────────────────────────

test("the winner takes exactly the games the series needed, the forfeiter none", () => {
  assert.deepEqual(forfeitScore(3, true), { homeScore: 0, awayScore: 2 });
  assert.deepEqual(forfeitScore(3, false), { homeScore: 2, awayScore: 0 });
  assert.deepEqual(forfeitScore(5, true), { homeScore: 0, awayScore: 3 });
  assert.deepEqual(forfeitScore(7, false), { homeScore: 4, awayScore: 0 });
  assert.deepEqual(forfeitScore(1, true), { homeScore: 0, awayScore: 1 });
});
