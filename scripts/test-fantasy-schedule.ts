import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSchedule, currentWeek, eliminatedManagers, playoffWeekCount, roundRobinWeek } from "../app/lib/fantasy-schedule";

const pairKey = (a: string, b: string | null) => [a, b ?? "BYE"].sort().join("-");

test("an even league meets every opponent once per cycle, then repeats", () => {
  const managers = ["a", "b", "c", "d", "e", "f"];
  const seen = new Set<string>();
  for (let w = 0; w < 5; w++) {
    const week = roundRobinWeek(managers, w);
    assert.equal(week.length, 3);
    assert.deepEqual(week.flatMap((p) => [p.a, p.b]).sort(), [...managers].sort());
    for (const p of week) seen.add(pairKey(p.a, p.b));
  }
  assert.equal(seen.size, 15);
  assert.deepEqual(roundRobinWeek(managers, 5), roundRobinWeek(managers, 0));
});

test("an odd league gives each manager one bye per cycle", () => {
  const managers = ["a", "b", "c", "d", "e"];
  const byes: string[] = [];
  for (let w = 0; w < 5; w++) {
    const week = roundRobinWeek(managers, w);
    const bye = week.filter((p) => p.b === null);
    assert.equal(bye.length, 1);
    byes.push(bye[0].a);
  }
  assert.deepEqual(byes.sort(), managers);
});

test("playoff weeks: two with 4+ managers, a lone final with fewer, none under 3 weeks", () => {
  assert.equal(playoffWeekCount(7, 4), 2);
  assert.equal(playoffWeekCount(7, 3), 1);
  assert.equal(playoffWeekCount(2, 6), 0);
});

const pointsTable = (rows: Record<number, Record<string, number>>) => (week: number, m: string) => rows[week]?.[m] ?? 0;

test("the regular season is the rounds minus two; seeds 1v4 and 2v3 once it closes", () => {
  const managers = ["a", "b", "c", "d"];
  // a always scores most, d least.
  const pts = pointsTable({
    1: { a: 40, b: 30, c: 20, d: 10 },
    2: { a: 40, b: 30, c: 20, d: 10 },
    3: { a: 40, b: 30, c: 20, d: 10 },
  });
  const open = buildSchedule({ managers, totalWeeks: 5, closedWeeks: new Set([1, 2]), points: pts });
  assert.deepEqual(open.weeks.map((w) => w.kind), ["regular", "regular", "regular", "semifinal", "final"]);
  assert.equal(open.weeks[3].pending, true);
  assert.equal(currentWeek(open.weeks), 3);

  const closed = buildSchedule({ managers, totalWeeks: 5, closedWeeks: new Set([1, 2, 3]), points: pts });
  assert.deepEqual(closed.standings.map((s) => s.managerId), ["a", "b", "c", "d"]);
  assert.deepEqual(closed.standings[0], { managerId: "a", wins: 3, losses: 0, ties: 0, pointsFor: 120 });
  const semis = closed.weeks[3];
  assert.equal(semis.pending, false);
  assert.deepEqual(semis.matchups.map((m) => [m.a, m.b]), [["a", "d"], ["b", "c"]]);
  assert.equal(closed.weeks[4].pending, true);
});

test("a tied playoff matchup goes to the higher seed, and the final crowns a champion", () => {
  const managers = ["a", "b", "c", "d"];
  const regular = { a: 40, b: 30, c: 20, d: 10 };
  const pts = pointsTable({ 1: regular, 2: regular, 3: regular, 4: { a: 5, d: 9, b: 15, c: 15 }, 5: { d: 50, b: 1 } });
  const s = buildSchedule({ managers, totalWeeks: 5, closedWeeks: new Set([1, 2, 3, 4, 5]), points: pts });
  assert.deepEqual(s.weeks[3].matchups.map((m) => m.winner), ["d", "b"]);
  assert.deepEqual(s.weeks[4].matchups.map((m) => [m.a, m.b]), [["d", "b"]]);
  assert.equal(s.champion, "d");
});

test("a regular-season tie counts as a tie, and an open week decides nothing", () => {
  const managers = ["a", "b"];
  const s = buildSchedule({ managers, totalWeeks: 2, closedWeeks: new Set([1]), points: pointsTable({ 1: { a: 10, b: 10 }, 2: { a: 99 } }) });
  assert.equal(s.weeks[0].matchups[0].winner, null);
  assert.equal(s.standings[0].ties, 1);
  assert.equal(s.weeks[1].matchups[0].winner, null);
  assert.equal(s.weeks[1].matchups[0].aPoints, 99);
});

test("elimination: nobody mid-season, non-seeds after it, semifinal losers, then everyone", () => {
  const managers = ["a", "b", "c", "d", "e", "f"];
  const regular = { a: 60, b: 50, c: 40, d: 30, e: 20, f: 10 };
  const pts = pointsTable({ 1: regular, 2: regular, 3: regular, 4: { a: 5, d: 9, b: 15, c: 10 }, 5: { d: 1, b: 2 } });
  const at = (closed: number[]) =>
    [...eliminatedManagers(buildSchedule({ managers, totalWeeks: 5, closedWeeks: new Set(closed), points: pts }))].sort();
  assert.deepEqual(at([1, 2]), []);
  assert.deepEqual(at([1, 2, 3]), ["e", "f"]);
  assert.deepEqual(at([1, 2, 3, 4]), ["a", "c", "e", "f"]);
  assert.deepEqual(at([1, 2, 3, 4, 5]), managers);
});

test("elimination with a lone final freezes everyone outside the top two", () => {
  const managers = ["a", "b", "c"];
  const s = buildSchedule({ managers, totalWeeks: 4, closedWeeks: new Set([1, 2, 3]), points: (_, m) => ({ a: 3, b: 2, c: 1 })[m]! });
  assert.deepEqual([...eliminatedManagers(s)], ["c"]);
});

test("a bye earns no record and no tiebreak points", () => {
  const managers = ["a", "b", "c"];
  const s = buildSchedule({ managers, totalWeeks: 1, closedWeeks: new Set([1]), points: () => 10 });
  const bye = s.weeks[0].matchups.find((m) => m.b === null)!;
  const row = s.standings.find((r) => r.managerId === bye.a)!;
  assert.deepEqual([row.wins, row.losses, row.ties, row.pointsFor], [0, 0, 0, 0]);
});
