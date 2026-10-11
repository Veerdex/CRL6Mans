import test from "node:test";
import assert from "node:assert/strict";
import {
  getSeedOrder,
  getDEWBRounds,
  getDELBRounds,
  wbLoserTarget,
  lbWinnerTarget,
  dropMatchNum,
  getDELBFeederLabel,
  getMatchLabel,
} from "../app/lib/bracket";

// A DE bracket played out to the end, with the winners-bracket drop order left
// pluggable so the alternating scheme can be measured against the alternatives
// instead of taken on faith from a bracket guide.
type DropFn = (wbRound: number, matchNum: number, size: number) => number;

const straight: DropFn = (_r, m) => m;
const alwaysReverse: DropFn = (r, m, size) => size / 2 ** r - m + 1;

type Slot = { home: number | null; away: number | null };
type Rematch = { lbRound: number; stalenessInWBRounds: number };

// `bits` decides every match: bit set → the home side wins. Seeds are 1..size,
// full field, no byes (byes only ever remove drops, never create pairings).
function playDE(size: number, bits: (i: number) => boolean, drop: DropFn) {
  const numWB = getDEWBRounds(size);
  const numLB = getDELBRounds(size);
  let bit = 0;

  // The WB round in which a given pair met, keyed by the unordered pair.
  const metInWBRound = new Map<string, number>();
  const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const lb: Slot[][] = [];
  for (let r = 1; r <= numLB; r++) {
    const count = size / 2 ** (Math.ceil(r / 2) + 1);
    lb[r] = Array.from({ length: count }, () => ({ home: null, away: null }));
  }

  const place = (r: number, m: number, slot: "home_team_id" | "away_team_id", team: number) => {
    const s = lb[r][m - 1];
    const field = slot === "home_team_id" ? "home" : "away";
    assert.equal(s[field], null, `LB r${r}m${m} ${field} written twice — mapping collision`);
    s[field] = team;
  };

  // The whole winners bracket first: nothing in the LB can affect it.
  const order = getSeedOrder(size);
  let wbRoundTeams: number[] = order.slice();
  for (let r = 1; r <= numWB; r++) {
    const next: number[] = [];
    for (let m = 1; m <= wbRoundTeams.length / 2; m++) {
      const home = wbRoundTeams[2 * (m - 1)];
      const away = wbRoundTeams[2 * (m - 1) + 1];
      metInWBRound.set(pairKey(home, away), r);
      const homeWins = bits(bit++);
      next.push(homeWins ? home : away);
      const loser = homeWins ? away : home;
      const t = wbLoserTarget(r, m, size);
      // Round 1's mapping is fixed (two losers per LB match); only the drop
      // rounds are the scheme under test.
      place(t.lbRound, r === 1 ? t.lbMatchNum : drop(r, m, size), t.slot, loser);
    }
    wbRoundTeams = next;
  }

  // Then the losers bracket, round by round.
  const rematches: Rematch[] = [];
  for (let r = 1; r <= numLB; r++) {
    for (let m = 1; m <= lb[r].length; m++) {
      const { home, away } = lb[r][m - 1];
      assert.ok(home !== null && away !== null, `LB r${r}m${m} never filled — mapping gap`);
      const metIn = metInWBRound.get(pairKey(home, away));
      if (metIn !== undefined) {
        rematches.push({ lbRound: r, stalenessInWBRounds: metIn });
      }
      const winner = bits(bit++) ? home : away;
      const t = lbWinnerTarget(r, m, numLB);
      if (t.section === "losers") place(t.round, t.matchNum, t.slot, winner);
    }
  }

  return { rematches };
}

function allOutcomes(size: number, drop: DropFn): Rematch[][] {
  const numWB = getDEWBRounds(size);
  const numLB = getDELBRounds(size);
  let decisions = 0;
  for (let r = 1; r <= numWB; r++) decisions += size / 2 ** r;
  for (let r = 1; r <= numLB; r++) decisions += size / 2 ** (Math.ceil(r / 2) + 1);

  const out: Rematch[][] = [];
  for (let mask = 0; mask < 2 ** decisions; mask++) {
    out.push(playDE(size, (i) => ((mask >> i) & 1) === 1, drop).rematches);
  }
  return out;
}

function randomOutcomes(size: number, drop: DropFn, trials: number): Rematch[][] {
  let state = 0x2545f491;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  const out: Rematch[][] = [];
  for (let t = 0; t < trials; t++) {
    const cache: boolean[] = [];
    out.push(playDE(size, (i) => (cache[i] ??= (next() & 1) === 1), drop).rematches);
  }
  return out;
}

const firstDropRound = 2;

test("the first drop round is rematch-free from 8 teams up", () => {
  for (const rematches of allOutcomes(8, dropMatchNum)) {
    assert.deepEqual(
      rematches.filter((r) => r.lbRound === firstDropRound),
      [],
      "a WB R2 loser met a team it had already played",
    );
  }
  for (const size of [16, 32]) {
    for (const rematches of randomOutcomes(size, dropMatchNum, 20000)) {
      assert.deepEqual(rematches.filter((r) => r.lbRound === firstDropRound), []);
    }
  }
});

test("a 4-team bracket cannot be made rematch-free, and isn't claimed to be", () => {
  // Every round of a 4-team LB is a single match, so there is no opposite side
  // to cross to: the WB final loser always meets one of the two WB R1 losers,
  // and it beat one of them. The crossing is a no-op here by arithmetic
  // (count - m + 1 === 1), not by an exception in the mapping.
  assert.equal(dropMatchNum(2, 1, 4), 1);
  const rematching = allOutcomes(4, dropMatchNum).filter((rs) => rs.length > 0);
  assert.ok(rematching.length > 0);
  // But it is only ever the stale round-1 game, never the WB final it just lost.
  for (const rs of rematching) {
    for (const r of rs) assert.equal(r.stalenessInWBRounds, 1);
  }
});

test("straight drops do produce first-drop-round rematches — the bug this fixes", () => {
  const withRematch = allOutcomes(8, straight).filter((rs) =>
    rs.some((r) => r.lbRound === firstDropRound),
  );
  assert.ok(withRematch.length > 0, "straight drop should rematch — the test would prove nothing");
});

test("alternating beats always-reverse on total drop-round rematches", () => {
  const count = (drop: DropFn, size: number, trials: number) =>
    randomOutcomes(size, drop, trials)
      .flat()
      .filter((r) => r.lbRound % 2 === 0).length;

  // Size 16 is the first bracket with a second drop round (LB R4) to disagree on.
  const alternating = count(dropMatchNum, 16, 20000);
  const reversed = count(alwaysReverse, 16, 20000);
  assert.ok(
    alternating < reversed,
    `alternating (${alternating}) should rematch less than always-reverse (${reversed})`,
  );
});

// The invariant that actually holds at every size and every drop round, and the
// reason the scheme alternates: past the first drop round the crossing has to
// give something up, and it gives up the stale WB round-1 pairing rather than
// the round the dropper has only just come from.
test("no dropper ever meets the team it beat in the round it dropped from", () => {
  const check = (rematches: Rematch[]) => {
    for (const r of rematches) {
      if (r.lbRound % 2 !== 0) continue;
      assert.notEqual(r.stalenessInWBRounds, r.lbRound / 2 + 1);
    }
  };
  for (const size of [4, 8]) allOutcomes(size, dropMatchNum).forEach(check);
  for (const size of [16, 32]) randomOutcomes(size, dropMatchNum, 20000).forEach(check);
});

test("feeder labels name the WB match the crossing actually sends down", () => {
  for (const size of [4, 8, 16, 32]) {
    const numWB = getDEWBRounds(size);
    const numLB = getDELBRounds(size);
    for (let wbRound = 2; wbRound <= numWB; wbRound++) {
      for (let m = 1; m <= size / 2 ** wbRound; m++) {
        const t = wbLoserTarget(wbRound, m, size);
        assert.ok(t.lbRound % 2 === 0 && t.lbRound <= numLB);
        assert.equal(
          getDELBFeederLabel(t.lbRound, t.lbMatchNum, "away", size),
          `Loser of W-${getMatchLabel(wbRound, m, size / 2)}`,
        );
      }
    }
  }
});

test("WB round 1 still drops straight into LB round 1", () => {
  for (const size of [4, 8, 16]) {
    for (let m = 1; m <= size / 2; m++) {
      const t = wbLoserTarget(1, m, size);
      assert.deepEqual(t, {
        lbRound: 1,
        lbMatchNum: Math.ceil(m / 2),
        slot: m % 2 === 1 ? "home_team_id" : "away_team_id",
      });
    }
  }
});

test("round 1 is seeded best against worst, byes to the top seeds", () => {
  // getSeedOrder's contract, which is what the request's ABCD example describes.
  assert.deepEqual(getSeedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(getSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);

  // 7 teams in an 8 bracket: seed 8 is absent, so seed 1 is the one that byes.
  const order = getSeedOrder(8);
  const absent = (seed: number) => seed > 7;
  const byes = [];
  for (let i = 0; i < 4; i++) {
    if (absent(order[2 * i + 1])) byes.push(order[2 * i]);
  }
  assert.deepEqual(byes, [1]);
});
