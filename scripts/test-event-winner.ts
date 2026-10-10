import test from "node:test";
import assert from "node:assert/strict";
import {
  decideEventWinner, TERMINAL_STAGES,
  DE_GF, DE_WINNERS, DE_LOSERS, SWISS_STAGE, HYBRID_GF, HYBRID8_GF,
  type DecidingMatch,
} from "../app/lib/bracket";

function m(
  stage: string, round: number, match_number: number,
  home: string | null, away: string | null,
  hs: number | null = null, as: number | null = null,
): DecidingMatch {
  return { stage, round, match_number, home_team_id: home, away_team_id: away, home_score: hs, away_score: as };
}

test("terminal stages are exactly the four championship-deciding ones", () => {
  assert.deepEqual(
    [...TERMINAL_STAGES].sort(),
    ["de_grand_final", "hybrid8_gf", "hybrid_gf", "single_elimination"],
  );
});

test("no terminal match at all falls back to the caller's standings", () => {
  assert.equal(decideEventWinner([]), null);
  assert.equal(decideEventWinner([m(SWISS_STAGE, 5, 1, "a", "b", 2, 0)]), null);
});

test("single elimination takes the deepest round, not the last reported match", () => {
  // A semifinal sits in round 2 with a higher match_number than the final.
  const matches = [
    m("single_elimination", 1, 1, "a", "b", 2, 1),
    m("single_elimination", 1, 2, "c", "d", 0, 2),
    m("single_elimination", 2, 1, "a", "d", 1, 2),
    m("single_elimination", 3, 1, "d", "x", 2, 0),
  ];
  assert.deepEqual(decideEventWinner(matches), { championId: "d", runnerUpId: "x" });
});

test("an SE final that hasn't been played yields null even though the semis have", () => {
  const matches = [
    m("single_elimination", 1, 1, "a", "b", 2, 1),
    m("single_elimination", 2, 1, "a", "c", 2, 0),
    m("single_elimination", 3, 1, "a", "d"), // scheduled, no score
  ];
  assert.equal(decideEventWinner(matches), null);
});

test("a DE grand final with no reset reads match 1 and ignores the empty match 2", () => {
  const matches = [
    m(DE_WINNERS, 3, 1, "wb", "x", 2, 0),
    m(DE_LOSERS, 5, 1, "lb", "y", 2, 1),
    m(DE_GF, 1, 1, "wb", "lb", 2, 0),
    m(DE_GF, 1, 2, null, null), // the reset row, never activated
  ];
  assert.deepEqual(decideEventWinner(matches), { championId: "wb", runnerUpId: "lb" });
});

test("a DE bracket reset crowns the winner of match 2, who has the worse record", () => {
  // The exact case a win/loss ranking gets wrong: `lb` won five series to
  // `wb`'s four, and still lost the event.
  const matches = [
    m(DE_GF, 1, 1, "wb", "lb", 1, 2),
    m(DE_GF, 1, 2, "wb", "lb", 2, 1),
  ];
  assert.deepEqual(decideEventWinner(matches), { championId: "wb", runnerUpId: "lb" });
});

test("a reset that was activated but not played leaves the event undecided", () => {
  const matches = [
    m(DE_GF, 1, 1, "wb", "lb", 1, 2),
    m(DE_GF, 1, 2, "wb", "lb"),
  ];
  assert.equal(decideEventWinner(matches), null);
});

test("hybrid grand finals decide their own events", () => {
  assert.deepEqual(
    decideEventWinner([m(HYBRID_GF, 1, 1, "a", "b", 0, 3)]),
    { championId: "b", runnerUpId: "a" },
  );
  assert.deepEqual(
    decideEventWinner([m(HYBRID8_GF, 1, 1, "a", "b", 3, 2)]),
    { championId: "a", runnerUpId: "b" },
  );
});

test("a swept Swiss run can't outrank the final", () => {
  const matches = [
    ...[1, 2, 3, 4, 5].map((r) => m(SWISS_STAGE, r, 1, "sweeper", `v${r}`, 2, 0)),
    m("single_elimination", 1, 1, "sweeper", "scrappy", 1, 2),
    m("single_elimination", 2, 1, "scrappy", "other", 2, 1),
  ];
  assert.deepEqual(decideEventWinner(matches), { championId: "scrappy", runnerUpId: "other" });
});
