// Embed limit + content tests for app/lib/draft-embeds.ts.
//
// Discord rejects the whole message if any single field value exceeds 1024
// characters, so a large enough captain list would silently kill the draft
// announcement rather than truncate it. That limit is what most of this file
// guards; the rest checks the pick order shown matches the order enforced.
//
// Run with: npm run test:draft-embeds

import assert from "node:assert/strict";
import { test } from "node:test";
import { getTeamNumberForPick } from "../app/lib/draft-order";
import {
  draftLabel, draftStartEmbed, onTheClockEmbed,
  pickEmbed, draftCompleteEmbed,
  type CaptainSeat,
} from "../app/lib/draft-embeds";

const FIELD_LIMIT = 1024;
const TITLE_LIMIT = 256;
const EMBED_LIMIT = 6000;

function seats(numTeams: number, nameLen = 24): CaptainSeat[] {
  return Array.from({ length: numTeams }, (_, i) => ({
    teamNum: numTeams - i,
    name: "x".repeat(nameLen),
    rv: 1800 - i,
  }));
}

function embedSize(e: { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text: string } }): number {
  return (e.title?.length ?? 0)
    + (e.description?.length ?? 0)
    + (e.footer?.text.length ?? 0)
    + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
}

test("draftLabel only calls it a snake draft when there are rounds to snake between", () => {
  assert.equal(draftLabel(3), "Snake Draft");
  assert.equal(draftLabel(2), "2v2 Draft");
});

test("a 32-team captain list splits across fields instead of blowing the 1024 limit", () => {
  const embed = draftStartEmbed({
    teamSize: 3, numTeams: 32, entered: 96, undrafted: 0, captains: seats(32),
  });
  const fields = embed.fields ?? [];

  for (const f of fields) assert.ok(f.value.length <= FIELD_LIMIT, `field "${f.name}" is ${f.value.length} chars`);
  assert.ok(fields.length > 2, "32 captains should need more than one captain field");
  assert.ok(fields.length <= 25, "Discord allows at most 25 fields");
  assert.ok(embedSize(embed) <= EMBED_LIMIT);
  assert.ok((embed.title ?? "").length <= TITLE_LIMIT);

  // Splitting must not drop anyone: every team number still appears exactly once.
  const listed = fields.flatMap(f => [...f.value.matchAll(/\*\*Team (\d+)\*\*/g)].map(m => Number(m[1])));
  assert.deepEqual([...listed].sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i + 1));
});

test("a small draft keeps the captain list in a single named field", () => {
  const fields = draftStartEmbed({
    teamSize: 3, numTeams: 4, entered: 12, undrafted: 0, captains: seats(4),
  }).fields ?? [];
  const captainFields = fields.filter(f => f.name !== "​" && f.name.startsWith("Captains"));
  assert.equal(captainFields.length, 1);
  assert.equal(captainFields[0].value.split("\n").length, 4);
});

test("the pick order shown is the pick order getTeamNumberForPick enforces", () => {
  const order = (numTeams: number, teamSize: number) =>
    (draftStartEmbed({ teamSize, numTeams, entered: numTeams * teamSize, undrafted: 0, captains: seats(numTeams) })
      .fields ?? []).find(f => f.name.startsWith("Pick order"))!;

  const snake = order(4, 3);
  assert.equal(snake.name, "Pick order (snake)");
  assert.deepEqual(snake.value.split("\n"), ["**Round 1:** 4, 3, 2, 1", "**Round 2:** 1, 2, 3, 4"]);

  // 2v2 is one round, and it must read as the real order, not a snake's first leg.
  const single = order(4, 2);
  assert.equal(single.name, "Pick order (lowest Rank Value first)");
  assert.equal(
    single.value,
    Array.from({ length: 4 }, (_, i) => getTeamNumberForPick(i, 4)).join(", "),
  );
});

test("the completion embed names the format instead of always saying snake", () => {
  assert.equal(draftCompleteEmbed({ teamSize: 2, numTeams: 4, totalPicks: 4 }).title, "🏁 2v2 Draft complete!");
  assert.equal(draftCompleteEmbed({ teamSize: 3, numTeams: 4, totalPicks: 8 }).title, "🏁 Snake Draft complete!");
});

test("no embed carries a mention, since mentions inside embeds never notify", () => {
  const all = [
    draftStartEmbed({ teamSize: 3, numTeams: 4, entered: 12, undrafted: 2, captains: seats(4) }),
    onTheClockEmbed(3),
    pickEmbed({ teamName: "Team 4", playerName: "someone", pickNumber: 1, totalPicks: 8 }),
    pickEmbed({ teamName: "Team 2", playerName: "someone", pickNumber: 2, totalPicks: 8, auto: true }),
    draftCompleteEmbed({ teamSize: 3, numTeams: 4, totalPicks: 8 }),
  ];
  for (const e of all) {
    const text = [e.title, e.description, e.footer?.text, ...(e.fields ?? []).flatMap(f => [f.name, f.value])].join(" ");
    assert.ok(!/<@|@everyone|@here/.test(text), `embed "${e.title}" contains a mention`);
    assert.ok(e.color, `embed "${e.title}" has no colour`);
  }
});

test("a timed-out pick still reads as a pick, just an amber one", () => {
  const manual = pickEmbed({ teamName: "Team 4", playerName: "Aerose.", pickNumber: 1, totalPicks: 8 });
  const auto = pickEmbed({ teamName: "Team 4", playerName: "Aerose.", pickNumber: 1, totalPicks: 8, auto: true });

  // Both name the player, because both are the message the pick ends up as.
  for (const e of [manual, auto]) {
    assert.match(e.title!, /Aerose\./);
    assert.equal(e.footer!.text, "Pick 1 of 8");
  }
  assert.notEqual(manual.color, auto.color, "a timeout should be visually distinct from a normal pick");
  assert.match(auto.title!, /ran out of time/);
});

test("the start embed reports the undrafted overflow only when there is some", () => {
  const withOverflow = draftStartEmbed({ teamSize: 3, numTeams: 4, entered: 14, undrafted: 2, captains: seats(4) });
  assert.match(withOverflow.description!, /2 not drafted/);
  const exact = draftStartEmbed({ teamSize: 3, numTeams: 4, entered: 12, undrafted: 0, captains: seats(4) });
  assert.doesNotMatch(exact.description!, /not drafted/);
});
