import { test } from "node:test";
import assert from "node:assert/strict";

import { lineupNotice, ordinal, scheduleNotices, waiverNotice } from "../app/lib/fantasy-notices";
import { buildSchedule } from "../app/lib/fantasy-schedule";

const managers = ["a", "b", "c", "d", "e", "f"];
const strength: Record<string, number> = { a: 10, b: 9, c: 8, d: 7, e: 6, f: 5 };
const name = (id: string) => id.toUpperCase();
// Six weeks with six managers: four regular weeks, semifinals, final.
const season = (closed: number[]) =>
  buildSchedule({ managers, totalWeeks: 6, closedWeeks: new Set(closed), points: (_w, m) => strength[m] });

test("ordinal handles the teens", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103, 111].map(ordinal), [
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd", "111th",
  ]);
});

test("waiver titles follow what happened, one sentence per claim", () => {
  const won = { status: "won" as const, player: "X", drop: "Y", note: null };
  const lost = { status: "lost" as const, player: "Z", drop: "Y", note: null };
  const failed = { status: "failed" as const, player: "W", drop: "Y", note: "Your roster changed." };
  assert.equal(waiverNotice("L", [won]).title, "Waiver claim won");
  assert.equal(waiverNotice("L", [lost]).title, "Waiver claim missed");
  assert.equal(waiverNotice("L", [lost, failed]).title, "Waiver claims missed");
  const mixed = waiverNotice("L", [won, lost, failed]);
  assert.equal(mixed.title, "Waiver results");
  assert.equal(
    mixed.body,
    "L: You got X and dropped Y. Z went to a manager ahead of you in the waiver order. Your claim for W didn't go through: Your roster changed.",
  );
});

test("lineup notices list every starter who won't score", () => {
  assert.deepEqual(lineupNotice("L", "Week 2", [{ player: "X", reason: "bye" }]), {
    title: "A starter won't score",
    body: "L, Week 2: X has a bye, so that slot scores nothing unless you swap them out.",
  });
  assert.equal(
    lineupNotice("L", "Week 2", [
      { player: "X", reason: "bye" },
      { player: "Y", reason: "bye" },
      { player: "Z", reason: "ineligible" },
    ]).body,
    "L, Week 2: X has a bye, Y has a bye and Z isn't on a team, so those slots score nothing unless you swap them out.",
  );
});

test("nothing is due before a week closes", () => {
  assert.deepEqual(scheduleNotices(season([]), "L", name), []);
});

test("a closed regular week tells both sides of every matchup", () => {
  const due = scheduleNotices(season([1]), "L", name);
  assert.deepEqual(due.map((k) => k.key), ["result:1"]);
  const notices = due[0].notices;
  assert.equal(notices.length, 6);
  for (const n of notices) assert.equal(n.to.length, 1);
  const aNotice = notices.find((n) => n.to[0] === "a")!;
  assert.equal(aNotice.title, "Week 1: you won");
  assert.match(aNotice.body, /^L: you beat [B-F] 10\.0–\d\.0\.$/);
});

test("seeding is due once the regular season closes, and only then", () => {
  assert.ok(!scheduleNotices(season([1, 2, 3]), "L", name).some((k) => k.key === "seeding"));
  const seeding = scheduleNotices(season([1, 2, 3, 4]), "L", name).find((k) => k.key === "seeding")!;
  const by = new Map(seeding.notices.map((n) => [n.to[0], n]));
  assert.equal(by.get("a")!.body, "L: you finished 1st and face D in the semifinals.");
  assert.equal(by.get("c")!.body, "L: you finished 3rd and face B in the semifinals.");
  assert.equal(by.get("e")!.title, "Your season is over");
  assert.match(by.get("f")!.body, /^L: you finished 6th, outside the playoff spots\./);
});

test("semifinals and the final", () => {
  const semis = scheduleNotices(season([1, 2, 3, 4, 5]), "L", name).find((k) => k.key === "result:5")!;
  const by = new Map(semis.notices.map((n) => [n.to[0], n.title]));
  assert.deepEqual(Object.fromEntries(by), {
    a: "Through to the final",
    d: "Out in the semifinals",
    b: "Through to the final",
    c: "Out in the semifinals",
  });

  const final = scheduleNotices(season([1, 2, 3, 4, 5, 6]), "L", name).find((k) => k.key === "result:6")!;
  assert.deepEqual(
    final.notices.map((n) => [n.to, n.title]),
    [
      [["a"], "Fantasy champion!"],
      [["b"], "Runner-up"],
      [["c", "d", "e", "f"], "L has a champion"],
    ],
  );
  assert.equal(final.notices[2].body, "A beat B 10.0–9.0 in the final.");
});

test("a playoff tie says it went to the higher seed", () => {
  const tied = buildSchedule({
    managers,
    totalWeeks: 6,
    closedWeeks: new Set([1, 2, 3, 4, 5]),
    points: (w, m) => (w === 5 ? 1 : strength[m]),
  });
  const semis = scheduleNotices(tied, "L", name).find((k) => k.key === "result:5")!;
  const a = semis.notices.find((n) => n.to[0] === "a")!;
  assert.equal(a.title, "Through to the final");
  assert.match(a.body, /The tie went to the higher seed\./);
});
