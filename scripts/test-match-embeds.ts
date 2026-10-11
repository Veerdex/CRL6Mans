import { test } from "node:test";
import assert from "node:assert/strict";

import {
  teamPing,
  rolePing,
  tournamentIntroPost,
  seasonIntroPost,
  checkInPost,
  matchResultPost,
  seriesSubmittedPost,
  seriesRejectedPost,
  seriesEscalatedPost,
  replayReviewPost,
  replayRejectedPost,
  timeProposedPost,
  timeAcceptedPost,
  timeWithdrawnPost,
  timeRejectedPost,
  adminTimeApprovedPost,
  adminTimeDeclinedPost,
  subRequestedPost,
  subAcceptedPost,
  subRejectedPost,
  subEscalatedPost,
  subAdminApprovedPost,
  subCancelledPost,
  type ChannelPost,
  type SubPlayerRow,
} from "../app/lib/match-embeds";

// Includes @everyone because Discord's own role list does: GET /guilds/{id}/roles
// returns it under that literal name, with the guild ID as its ID.
const GUILD_ID = "999";
const ROLES = [
  { id: GUILD_ID, name: "@everyone" },
  { id: "100", name: "Top Tier" },
  { id: "200", name: "We Have The Meats" },
  { id: "300", name: "moderator" },
];

const HOME = teamPing("Top Tier", ROLES);
const AWAY = teamPing("We Have The Meats", ROLES);

const player = (username: string): SubPlayerRow => ({
  username,
  peak_2v2: "1500",
  current_2v2: "1400",
  peak_3v3: "1600",
  current_3v3: "1550",
  peak_1v1: null,
  current_1v1: null,
});

const introTeams = {
  homeName: "Top Tier",
  awayName: "We Have The Meats",
  homePing: HOME,
  awayPing: AWAY,
  bestOf: 5,
};

// Every post the module can build, so the invariant sweep below can't miss one by
// being written before a builder was added.
const ALL: Array<[string, ChannelPost]> = [
  ["tournamentIntro", tournamentIntroPost(introTeams, { name: "crl-abc", password: "123456" }, true)],
  ["tournamentIntro/reset", tournamentIntroPost(introTeams, { name: "crl-abc", password: "123456" }, false)],
  ["seasonIntro", seasonIntroPost(introTeams, 3, { lines: "Play any time: <t:1700000000:D>", coordinate: "- Coordinate a time." }, "<#999>")],
  ["checkIn/one", checkInPost({ teamName: "Top Tier", oppName: "We Have The Meats", teamPing: HOME, oppPing: AWAY, bothIn: false, deadlineTs: 1700000000 })],
  ["checkIn/both", checkInPost({ teamName: "Top Tier", oppName: "We Have The Meats", teamPing: HOME, oppPing: AWAY, bothIn: true, deadlineTs: 1700000000 })],
  ["matchResult/win", matchResultPost({ homeName: "Top Tier", awayName: "We Have The Meats", homePing: HOME, awayPing: AWAY, homeScore: 3, awayScore: 1, winnerName: "Top Tier" })],
  ["matchResult/draw", matchResultPost({ homeName: "Top Tier", awayName: "We Have The Meats", homePing: HOME, awayPing: AWAY, homeScore: 2, awayScore: 2, winnerName: null })],
  ["seriesSubmitted", seriesSubmittedPost({ teamName: "Top Tier", oppPing: AWAY, homeWins: 3, awayWins: 1 })],
  ["seriesRejected", seriesRejectedPost({ teamName: "Top Tier", oppPing: AWAY })],
  ["seriesEscalated", seriesEscalatedPost({ teamName: "Top Tier", homeWins: 3, awayWins: 1 })],
  ["replayReview", replayReviewPost(3, 1)],
  ["replayRejected", replayRejectedPost("Game 2 replay is from a different match.")],
  ["timeProposed", timeProposedPost({ teamName: "Top Tier", oppPing: AWAY, ts: 1700000000, isNewTime: false, note: "Head to the website." })],
  ["timeProposed/new", timeProposedPost({ teamName: "Top Tier", oppPing: AWAY, ts: 1700000000, isNewTime: true, note: "Head to the website." })],
  ["timeAccepted", timeAcceptedPost({ teamName: "Top Tier", proposerPing: AWAY, ts: 1700000000, needsAdmin: false })],
  ["timeAccepted/admin", timeAcceptedPost({ teamName: "Top Tier", proposerPing: AWAY, ts: 1700000000, needsAdmin: true })],
  ["timeWithdrawn", timeWithdrawnPost({ teamName: "Top Tier", oppPing: AWAY })],
  ["timeRejected", timeRejectedPost({ teamName: "Top Tier", proposerPing: AWAY, ts: 1700000000 })],
  ["adminTimeApproved", adminTimeApprovedPost(1700000000)],
  ["adminTimeDeclined", adminTimeDeclinedPost()],
  ["subRequested", subRequestedPost({ teamName: "Top Tier", oppPing: AWAY, playerOut: player("alice"), sub: player("bob"), reason: "sick" })],
  ["subRequested/noReason", subRequestedPost({ teamName: "Top Tier", oppPing: AWAY, playerOut: player("alice"), sub: player("bob"), reason: null })],
  // `/sub` with the optional reason omitted sends "" rather than null, since
  // Discord's option list simply has no entry and opt() falls back to "".
  ["subRequested/blankReason", subRequestedPost({ teamName: "Top Tier", oppPing: AWAY, playerOut: player("alice"), sub: player("bob"), reason: "" })],
  ["subAccepted", subAcceptedPost({ teamName: "Top Tier", playerOut: "alice" })],
  ["subRejected", subRejectedPost("Top Tier")],
  ["subEscalated", subEscalatedPost({ teamName: "Top Tier", modPing: rolePing("300") })],
  ["subAdminApproved", subAdminApprovedPost({ teamName: "Top Tier", playerOut: "alice" })],
  ["subCancelled", subCancelledPost({ teamName: "Top Tier", playerOut: "alice", oppPing: AWAY })],
];

// ─── The invariant that the whole module exists to protect ──────────────────────

test("no post puts a mention inside an embed", () => {
  for (const [name, post] of ALL) {
    const json = JSON.stringify(post.embeds);
    assert.ok(!json.includes("<@"), `${name}: embed contains a mention, which notifies nobody`);
    assert.ok(!json.includes("@everyone"), `${name}: embed contains @everyone`);
    assert.ok(!json.includes("@here"), `${name}: embed contains @here`);
  }
});

test("content carries only pings — no prose, no player-supplied text", () => {
  for (const [name, post] of ALL) {
    // Every token is a role mention and nothing else, so nothing a player typed
    // can reach the one part of the message Discord parses for mentions.
    const tokens = post.content.split(" ").filter(Boolean);
    for (const t of tokens)
      assert.match(t, /^<@&\d+>$/, `${name}: content token ${JSON.stringify(t)} is not a role mention`);
  }
});

test("every ping in the content is whitelisted in allowed_mentions", () => {
  for (const [name, post] of ALL) {
    const ids = [...post.content.matchAll(/<@&(\d+)>/g)].map((m) => m[1]);
    for (const id of ids)
      assert.ok(
        post.allowed_mentions.roles?.includes(id),
        `${name}: role ${id} is mentioned but not whitelisted, so Discord strips the ping`,
      );
    assert.deepEqual(post.allowed_mentions.parse, [], `${name}: parse must be empty`);
    // The reverse direction too: a whitelisted ID with no mention would be a ping
    // that silently went missing from the content.
    for (const id of post.allowed_mentions.roles ?? [])
      assert.ok(ids.includes(id), `${name}: role ${id} is whitelisted but not mentioned`);
  }
});

test("every post has exactly one embed", () => {
  for (const [name, post] of ALL)
    assert.equal(post.embeds.length, 1, `${name}: expected one embed`);
});

// ─── Discord's limits, which 400 the whole message rather than truncating ───────

test("no part of an embed exceeds its Discord limit", () => {
  for (const [name, post] of ALL) {
    for (const e of post.embeds) {
      if (e.title) assert.ok(e.title.length <= 256, `${name}: title over 256`);
      if (e.description) assert.ok(e.description.length <= 4096, `${name}: description over 4096`);
      if (e.footer) assert.ok(e.footer.text.length <= 2048, `${name}: footer over 2048`);
      assert.ok((e.fields ?? []).length <= 25, `${name}: over 25 fields`);
      for (const f of e.fields ?? []) {
        assert.ok(f.name.length <= 256, `${name}: field name over 256`);
        assert.ok(f.value.length <= 1024, `${name}: field "${f.name}" value over 1024`);
        assert.ok(f.name.length > 0 && f.value.length > 0, `${name}: field "${f.name}" is empty`);
      }
    }
  }
});

test("free text is clamped rather than allowed to blow the limit", () => {
  const long = "x".repeat(10_000);
  const rejected = replayRejectedPost(long);
  assert.ok(rejected.embeds[0].description!.length <= 4096);
  assert.ok(rejected.embeds[0].description!.endsWith("…"));

  const sub = subRequestedPost({
    teamName: "Top Tier",
    oppPing: AWAY,
    playerOut: player("alice"),
    sub: player("bob"),
    reason: long,
  });
  assert.ok(sub.embeds[0].description!.length <= 4096);

  const proposed = timeProposedPost({
    teamName: "Top Tier", oppPing: AWAY, ts: 1700000000, isNewTime: false, note: long,
  });
  assert.ok(proposed.embeds[0].description!.length <= 4096);

  const season = seasonIntroPost(introTeams, 1, { lines: long, coordinate: long }, "<#1>");
  for (const f of season.embeds[0].fields ?? []) assert.ok(f.value.length <= 1024);
});

// ─── Timestamps only render where Discord renders them ──────────────────────────

test("<t:…> markup stays out of titles, footers and field names", () => {
  for (const [name, post] of ALL) {
    for (const e of post.embeds) {
      assert.ok(!(e.title ?? "").includes("<t:"), `${name}: timestamp in title renders literally`);
      assert.ok(!(e.footer?.text ?? "").includes("<t:"), `${name}: timestamp in footer renders literally`);
      for (const f of e.fields ?? [])
        assert.ok(!f.name.includes("<t:"), `${name}: timestamp in field name renders literally`);
    }
  }
});

test("markdown stays out of footers, which render none", () => {
  for (const [name, post] of ALL)
    for (const e of post.embeds)
      assert.ok(!(e.footer?.text ?? "").includes("**"), `${name}: bold in footer renders literally`);
});

// ─── Ping resolution ────────────────────────────────────────────────────────────

test("teamPing resolves a role by name and yields its ID", () => {
  assert.deepEqual(teamPing("Top Tier", ROLES), { text: "<@&100>", id: "100" });
});

test("teamPing returns no ping for a team with no role", () => {
  // Not a bolded fallback: the name is already in the embed, so a fallback in the
  // content would only duplicate it.
  assert.equal(teamPing("Unrostered FC", ROLES), null);
});

test("teamPing never resolves a team name onto @everyone or @here", () => {
  // The real role list contains @everyone under that name, so a team called
  // "@everyone" matches it and would ping the whole server through the bot.
  assert.equal(teamPing("@everyone", ROLES), null);
  assert.equal(teamPing("@here", ROLES), null);
  // And the guild-wide role is never pingable even if a team somehow shares its ID.
  for (const [name, post] of ALL) {
    assert.ok(
      !(post.allowed_mentions.roles ?? []).includes(GUILD_ID),
      `${name}: whitelists the @everyone role`,
    );
    assert.ok(!post.content.includes(`<@&${GUILD_ID}>`), `${name}: mentions the @everyone role`);
  }
});

test("a post with no resolvable ping has empty content and no whitelist", () => {
  const post = seriesSubmittedPost({ teamName: "Top Tier", oppPing: null, homeWins: 3, awayWins: 0 });
  assert.equal(post.content, "");
  assert.deepEqual(post.allowed_mentions, { parse: [], roles: [] });
  // The embed still says everything; only the notification is lost.
  assert.ok(post.embeds[0].description!.includes("Top Tier"));
});

test("rolePing passes a known ID through and treats absence as no ping", () => {
  assert.deepEqual(rolePing("300"), { text: "<@&300>", id: "300" });
  assert.equal(rolePing(null), null);
  assert.equal(rolePing(undefined), null);
});

test("a role pinged twice is whitelisted once", () => {
  const post = matchResultPost({
    homeName: "Top Tier", awayName: "Top Tier",
    homePing: HOME, awayPing: HOME,
    homeScore: 1, awayScore: 0, winnerName: "Top Tier",
  });
  assert.deepEqual(post.allowed_mentions.roles, ["100"]);
});

// ─── Content the messages must actually carry ───────────────────────────────────

test("the tournament intro shows the lobby and only mentions check-in when there is one", () => {
  const withCheckIn = tournamentIntroPost(introTeams, { name: "crl-abc", password: "hunter2" }, true);
  const json = JSON.stringify(withCheckIn.embeds[0]);
  assert.ok(json.includes("crl-abc") && json.includes("hunter2"));
  assert.ok(json.includes("/checkin"));

  const reset = tournamentIntroPost(introTeams, { name: "crl-abc", password: "hunter2" }, false);
  assert.ok(!JSON.stringify(reset.embeds[0]).includes("/checkin"));
  assert.ok(JSON.stringify(reset.embeds[0]).includes("crl-abc"));
});

test("both teams are pinged on the intro and the result, one on everything else", () => {
  assert.equal(ALL.find(([n]) => n === "tournamentIntro")![1].allowed_mentions.roles!.length, 2);
  assert.equal(ALL.find(([n]) => n === "seasonIntro")![1].allowed_mentions.roles!.length, 2);
  assert.equal(ALL.find(([n]) => n === "matchResult/win")![1].allowed_mentions.roles!.length, 2);
  assert.equal(ALL.find(([n]) => n === "seriesSubmitted")![1].allowed_mentions.roles!.length, 1);
});

test("the check-in post pings only the opponent until both are in", () => {
  const one = checkInPost({ teamName: "Top Tier", oppName: "We Have The Meats", teamPing: HOME, oppPing: AWAY, bothIn: false, deadlineTs: 1700000000 });
  assert.deepEqual(one.allowed_mentions.roles, ["200"]);
  assert.ok(one.embeds[0].description!.includes("<t:1700000000:R>"));

  const both = checkInPost({ teamName: "Top Tier", oppName: "We Have The Meats", teamPing: HOME, oppPing: AWAY, bothIn: true, deadlineTs: 1700000000 });
  assert.deepEqual(both.allowed_mentions.roles, ["100", "200"]);
  // No deadline once both are in — there is nothing left to be late for.
  assert.ok(!both.embeds[0].description!.includes("<t:"));
});

test("the result embed states the score and the winner", () => {
  const win = matchResultPost({
    homeName: "Top Tier", awayName: "We Have The Meats",
    homePing: HOME, awayPing: AWAY, homeScore: 3, awayScore: 1, winnerName: "Top Tier",
  });
  assert.ok(win.embeds[0].description!.includes("3–1"));
  assert.ok(win.embeds[0].description!.includes("Top Tier"));

  const draw = matchResultPost({
    homeName: "Top Tier", awayName: "We Have The Meats",
    homePing: HOME, awayPing: AWAY, homeScore: 2, awayScore: 2, winnerName: null,
  });
  assert.ok(draw.embeds[0].description!.includes("Draw"));
});

test("the sub request keeps both players' rank detail side by side", () => {
  const post = subRequestedPost({
    teamName: "Top Tier", oppPing: AWAY,
    playerOut: player("alice"), sub: player("bob"), reason: "sick",
  });
  const fields = post.embeds[0].fields!;
  assert.equal(fields.length, 2);
  assert.ok(fields[0].name.includes("alice") && fields[1].name.includes("bob"));
  assert.ok(fields.every((f) => f.inline));
  assert.ok(fields[0].value.includes("Rank Value"));
  assert.ok(post.embeds[0].description!.includes("sick"));
});

test("every post has a title and a colour, so none renders as a bare grey block", () => {
  for (const [name, post] of ALL) {
    assert.ok(post.embeds[0].title, `${name}: no title`);
    assert.ok(typeof post.embeds[0].color === "number", `${name}: no colour`);
  }
});
