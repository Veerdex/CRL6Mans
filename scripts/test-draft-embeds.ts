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
  pickEmbed, draftCompleteEmbed, draftStartPost, onTheClockPost,
  type CaptainSeat,
} from "../app/lib/draft-embeds";

const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
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

const listedTeams = (text: string) =>
  [...text.matchAll(/\*\*Team (\d+)\*\*/g)].map(m => Number(m[1])).sort((a, b) => a - b);
const oneTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

test("a 32-team captain list sits unbroken in the description, past the field limit", () => {
  const embed = draftStartEmbed({
    teamSize: 3, numTeams: 32, entered: 96, undrafted: 0, captains: seats(32),
  });
  const description = embed.description ?? "";

  assert.ok(description.length > FIELD_LIMIT, "the list should be too long for one field");
  assert.ok(description.length <= DESCRIPTION_LIMIT);
  assert.ok(!(embed.fields ?? []).some(f => f.name.startsWith("Captains") || f.name === "​"),
    "split captain fields render with a gap between them");
  assert.deepEqual(listedTeams(description), oneTo(32));
  assert.ok(embedSize(embed) <= EMBED_LIMIT);
  assert.ok((embed.title ?? "").length <= TITLE_LIMIT);
});

test("a captain list too long for the description falls back to fields under the limit", () => {
  const embed = draftStartEmbed({
    teamSize: 3, numTeams: 64, entered: 192, undrafted: 0, captains: seats(64, 50),
  });
  const fields = embed.fields ?? [];

  assert.ok((embed.description ?? "").length <= DESCRIPTION_LIMIT);
  for (const f of fields) assert.ok(f.value.length <= FIELD_LIMIT, `field "${f.name}" is ${f.value.length} chars`);
  assert.ok(fields.length <= 25, "Discord allows at most 25 fields");
  // Splitting must not drop anyone: every team number still appears exactly once.
  assert.deepEqual(listedTeams(fields.map(f => f.value).join("\n")), oneTo(64));
});

test("the pick order shown is the pick order getTeamNumberForPick enforces", () => {
  const order = (numTeams: number, teamSize: number) =>
    (draftStartEmbed({ teamSize, numTeams, entered: numTeams * teamSize, undrafted: 0, captains: seats(numTeams) })
      .fields ?? []).find(f => f.name.startsWith("Pick order"))!;

  const snake = order(4, 3);
  assert.equal(snake.name, "Pick order (snake)");
  assert.deepEqual(snake.value.split("\n"), ["**Round 1:** 4 → 1", "**Round 2:** 1 → 4"]);
  assert.deepEqual(order(32, 3).value.split("\n"), ["**Round 1:** 32 → 1", "**Round 2:** 1 → 32"]);

  // 2v2 is one round, and it must read as the real order, not a snake's first leg.
  const single = order(4, 2);
  assert.equal(single.name, "Pick order (lowest Rank Value first)");
  const picks = Array.from({ length: 4 }, (_, i) => getTeamNumberForPick(i, 4));
  assert.equal(single.value, `${picks[0]} → ${picks[3]}`);
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

test("a pick names the captain who made it, falling back to the team", () => {
  const withCaptain = pickEmbed({ teamName: "Team 28", captainName: "Veerdex", playerName: "Aerose.", pickNumber: 5, totalPicks: 64, auto: true });
  assert.equal(withCaptain.title, "⏰ Veerdex ran out of time — auto-picked Aerose.");
  const manual = pickEmbed({ teamName: "Team 28", captainName: "Veerdex", playerName: "Aerose.", pickNumber: 5, totalPicks: 64 });
  assert.equal(manual.title, "✅ Veerdex picks Aerose.");
  const noCaptain = pickEmbed({ teamName: "Team 28", captainName: null, playerName: "Aerose.", pickNumber: 5, totalPicks: 64 });
  assert.equal(noCaptain.title, "✅ Team 28 picks Aerose.");
});

test("the start embed reports the undrafted overflow only when there is some", () => {
  const withOverflow = draftStartEmbed({ teamSize: 3, numTeams: 4, entered: 14, undrafted: 2, captains: seats(4) });
  assert.match(withOverflow.description!, /2 not drafted/);
  const exact = draftStartEmbed({ teamSize: 3, numTeams: 4, entered: 12, undrafted: 0, captains: seats(4) });
  assert.doesNotMatch(exact.description!, /not drafted/);
});

const opts = { teamSize: 3, numTeams: 4, entered: 12, undrafted: 0, captains: seats(4) };

test("the start post pings the event role in content and whitelists exactly it", () => {
  const post = draftStartPost(opts, "1549640098105004172");
  assert.equal(post.content, "<@&1549640098105004172>");
  assert.deepEqual(post.allowed_mentions, { parse: [], roles: ["1549640098105004172"] });
  const none = draftStartPost(opts, null);
  assert.equal(none.content, "");
  assert.deepEqual(none.allowed_mentions.roles, []);
});

test("the on-the-clock post pings a real captain in content, never in the embed", () => {
  const post = onTheClockPost(3, { discordId: "123456789012345678", name: "Cap" });
  assert.equal(post.content, "<@123456789012345678>");
  assert.deepEqual(post.allowed_mentions, { parse: [], users: ["123456789012345678"] });
  assert.doesNotMatch(post.embeds[0].description!, /<@/);
  assert.match(post.embeds[0].description!, /Cap/);
});

test("a test account captain gets their name shown, not a raw <@test_…>", () => {
  const post = onTheClockPost(3, { discordId: "test_1794172999047_0_d195", name: "GhostViper_d195" });
  assert.equal(post.content, "");
  assert.deepEqual(post.allowed_mentions.users, []);
  assert.match(post.embeds[0].description!, /GhostViper_d195/);
});
