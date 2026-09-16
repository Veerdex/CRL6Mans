// Draft order regression tests for app/lib/draft-order.ts.
//
// The rules under test are the ones stated in CLAUDE.md: the worst captain picks
// first at 2v2, the best captain picks first at 3v3, a draft is
// num_teams × (team_size - 1) picks, and 1v1 has no draft at all.
//
// Run with: npm run test:draft-order

import assert from "node:assert/strict";
import { test } from "node:test";
import { getTeamNumberForPick, totalDraftPicks, captainSeatOrder } from "../app/lib/draft-order";

// What execStartDraft does, minus the database. Players arrive sorted by Rank
// Value, best first, and are seated onto team slots numbered 1..numTeams
// ascending — see the `.sort((a, b) => a.num - b.num)` on numberedTeams.
//
// Returns the RV rank (0 = best) of whoever is on the clock for each pick, in
// order. That composition is the thing worth testing: getTeamNumberForPick alone
// says nothing about *who* picks first, because the seating map decides that.
function pickOrderByRvRank(numTeams: number, teamSize: number): number[] {
  const pickRounds = teamSize - 1;
  const teamsToUse = Array.from({ length: numTeams }, (_, i) => ({ num: i + 1 }));
  const captainTeams = captainSeatOrder(teamsToUse, pickRounds);

  // captainTeams is indexed by RV rank, so invert it to go team number → rank.
  const rvRankByTeamNum = new Map<number, number>(
    captainTeams.map((t, rvRank) => [t.num, rvRank])
  );

  return Array.from({ length: totalDraftPicks(numTeams, teamSize) }, (_, pick) =>
    rvRankByTeamNum.get(getTeamNumberForPick(pick, numTeams))!
  );
}

test("2v2: the worst captain picks first, and everyone picks exactly once", () => {
  for (const numTeams of [2, 3, 4, 6, 8]) {
    const order = pickOrderByRvRank(numTeams, 2);
    const worst = numTeams - 1;

    assert.equal(order.length, numTeams, `${numTeams} teams should be ${numTeams} picks`);
    assert.equal(order[0], worst, `at ${numTeams} teams the worst captain (rank ${worst}) should pick first`);
    assert.equal(order[order.length - 1], 0, "the best captain should pick last");

    // Worst → best with nothing repeated: a single round, no reversal.
    assert.deepEqual(order, Array.from({ length: numTeams }, (_, i) => worst - i));
  }
});

test("3v3: the best captain picks first, then the snake reverses", () => {
  for (const numTeams of [2, 3, 4, 6, 8]) {
    const order = pickOrderByRvRank(numTeams, 3);

    assert.equal(order.length, numTeams * 2, `${numTeams} teams should be ${numTeams * 2} picks`);
    assert.equal(order[0], 0, "the highest-RV captain should be on the clock at pick 0");

    const round1 = order.slice(0, numTeams);
    const round2 = order.slice(numTeams);
    assert.deepEqual(round1, Array.from({ length: numTeams }, (_, i) => i), "round 1 runs best → worst");
    assert.deepEqual(round2, [...round1].reverse(), "round 2 reverses it");

    // The reversal is the whole point: every captain's two picks sum to the same
    // total, so nobody gets both early slots.
    const first = order.indexOf(0);
    const second = order.lastIndexOf(0);
    assert.equal(first + second, numTeams * 2 - 1, "the best captain's two picks sit at opposite ends");
  }
});

test("2v2 and 3v3 disagree about who is on the clock at pick 0", () => {
  // The flip is deliberate and easy to regress — it's a single ternary in
  // captainSeatOrder. Pinned here so a 3v3-shaped "fix" can't quietly take 2v2
  // back to the best captain picking first.
  for (const numTeams of [2, 4, 8]) {
    assert.notEqual(
      pickOrderByRvRank(numTeams, 2)[0],
      pickOrderByRvRank(numTeams, 3)[0],
      `at ${numTeams} teams, 2v2 and 3v3 should start with different captains`
    );
  }
});

test("a draft is num_teams × (team_size - 1) picks", () => {
  assert.equal(totalDraftPicks(4, 3), 8);
  assert.equal(totalDraftPicks(4, 2), 4);
  assert.equal(totalDraftPicks(8, 3), 16);
  assert.equal(totalDraftPicks(2, 2), 2);

  // Captains are seated before pick 0, so the picks fill the roster exactly.
  for (const numTeams of [2, 4, 8]) {
    for (const teamSize of [2, 3]) {
      const seatedCaptains = numTeams;
      assert.equal(
        seatedCaptains + totalDraftPicks(numTeams, teamSize),
        numTeams * teamSize,
        `${numTeams}×${teamSize} should end with full rosters and no spare picks`
      );
    }
  }
});

test("1v1 has nothing to draft", () => {
  // Why sanitize() in admin/tournament-actions.ts rejects snake_draft at
  // team_size 1, and why execStartDraft bails before touching the pool: a 1v1
  // team is its own captain, so the draft would be zero picks long. Those two
  // guards are DB-bound and covered by the manual 1v1 run, not by this file.
  for (const numTeams of [2, 3, 4, 8, 16]) {
    assert.equal(totalDraftPicks(numTeams, 1), 0, `${numTeams} 1v1 teams should be 0 picks`);
    assert.equal(pickOrderByRvRank(numTeams, 1).length, 0, "nobody should ever be on the clock");
  }
});

test("every pick lands on a real team, and rounds alternate direction", () => {
  // Guards the snake math itself against off-by-one: no Team 0, no Team N+1.
  for (const numTeams of [2, 3, 4, 5, 8]) {
    for (let pick = 0; pick < numTeams * 4; pick++) {
      const teamNum = getTeamNumberForPick(pick, numTeams);
      assert.ok(
        Number.isInteger(teamNum) && teamNum >= 1 && teamNum <= numTeams,
        `pick ${pick} of ${numTeams} teams gave Team ${teamNum}`
      );
    }
    // Each round is a permutation of 1..numTeams, alternating direction.
    for (let round = 0; round < 4; round++) {
      const nums = Array.from({ length: numTeams }, (_, i) =>
        getTeamNumberForPick(round * numTeams + i, numTeams)
      );
      const ascending = Array.from({ length: numTeams }, (_, i) => i + 1);
      assert.deepEqual([...nums].sort((a, b) => a - b), ascending, `round ${round} skipped or repeated a team`);
      assert.deepEqual(nums, round % 2 === 0 ? [...ascending].reverse() : ascending);
    }
  }
});
