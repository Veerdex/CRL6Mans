import { test } from "node:test";
import assert from "node:assert/strict";

import { completionNotices, placedStandings, withoutDetail, type FantasyLeagueSummary } from "../app/lib/fantasy-archive";
import { buildSchedule } from "../app/lib/fantasy-schedule";

const managers = ["a", "b", "c", "d", "e", "f"];
const regular: Record<string, number> = { a: 10, b: 9, c: 8, d: 7, e: 6, f: 5 };
// D tops the playoffs from the 4th seed, so the finishing order differs from the table.
const playoff: Record<string, number> = { a: 1, b: 9, c: 8, d: 20, e: 0, f: 0 };
// Six weeks with six managers: four regular weeks, semifinals (5), final (6).
const season = (closed: number[]) =>
  buildSchedule({ managers, totalWeeks: 6, closedWeeks: new Set(closed), points: (w, m) => (w >= 5 ? playoff[m] : regular[m]) });

const summaryOf = (closed: number[]): FantasyLeagueSummary => {
  const schedule = season(closed);
  return {
    seasonName: "Fall 2026",
    endedAt: "2026-11-09T00:00:00.000Z",
    managers: managers.map((id) => ({ id, discordId: null, name: id.toUpperCase(), username: null })),
    standings: placedStandings(schedule),
    champion: schedule.champion,
    detail: { schedule, lineups: [], rosters: [], draft: [] },
  };
};

test("a finished season places the finalists first, then the regular-season table", () => {
  const placed = placedStandings(season([1, 2, 3, 4, 5, 6]));
  assert.deepEqual(placed.map((s) => s.managerId), ["d", "b", "a", "c", "e", "f"]);
  assert.deepEqual(placed.map((s) => s.place), [1, 2, 3, 4, 5, 6]);
});

test("a season that ends before its final keeps the regular-season order", () => {
  const placed = placedStandings(season([1, 2, 3, 4, 5]));
  assert.deepEqual(placed.map((s) => s.managerId), ["a", "b", "c", "d", "e", "f"]);
});

test("the champion hears they won, everyone else hears who did and where they finished", () => {
  const notices = completionNotices("Rivals", summaryOf([1, 2, 3, 4, 5, 6]));
  assert.equal(notices.length, 6);
  assert.ok(notices.every((n) => n.title === "Fantasy season complete"));
  assert.deepEqual(notices[0], { to: "d", title: "Fantasy season complete", body: "Rivals: you're the champion of Fall 2026." });
  assert.equal(notices[1].body, "Rivals: D won Fall 2026, and you finished 2nd.");
  assert.equal(notices[5].body, "Rivals: D won Fall 2026, and you finished 6th.");
});

test("with no champion the notices say the season is over", () => {
  const notices = completionNotices("Rivals", summaryOf([1, 2, 3, 4]));
  assert.equal(notices[0].body, "Rivals: Fall 2026 is over, and you finished 1st.");
});

test("withoutDetail drops only the detail", () => {
  const full = summaryOf([1, 2, 3, 4, 5, 6]);
  const slim = withoutDetail(full);
  assert.equal("detail" in slim, false);
  assert.deepEqual({ ...slim, detail: full.detail }, full);
});
