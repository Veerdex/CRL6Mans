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

const submitted = {
  teamName: "Top Tier",
  oppPing: AWAY,
  homeName: "Top Tier",
  awayName: "We Have The Meats",
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
  ["seriesSubmitted", seriesSubmittedPost({ ...submitted, homeWins: 3, awayWins: 1 })],
  ["seriesSubmitted/loose", seriesSubmittedPost({ ...submitted, homeWins: 3, awayWins: 1, unmatchedNames: ["Rando"], replayAnalysisMode: "loose" })],
  ["seriesSubmitted/strict", seriesSubmittedPost({ ...submitted, homeWins: 1, awayWins: 3, unmatchedNames: ["Rando"], replayAnalysisMode: "strict" })],
  // A Rocket League display name is whatever that player typed, and they need not
  // be one of ours — so the invariant sweep sees the hostile case too.
  ["seriesSubmitted/hostile", seriesSubmittedPost({ ...submitted, homeWins: 3, awayWins: 0, unmatchedNames: ["@everyone", "@here", "<@&100>", "<@7>"], replayAnalysisMode: "loose" })],
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

test("a mention drawn inside an embed is always pinged in the content too", () => {
  for (const [name, post] of ALL) {
    const json = JSON.stringify(post.embeds);
    assert.ok(!json.includes("@everyone"), `${name}: embed contains @everyone`);
    assert.ok(!json.includes("@here"), `${name}: embed contains @here`);
    assert.ok(!/<@!?\d+>/.test(json), `${name}: embed contains a user mention`);
    // A role mention inside an embed renders as the role's chip but notifies
    // nobody, so it is a way of drawing a name and never a way of reaching a
    // team: whatever is drawn that way must also be pinged in the content.
    for (const id of [...json.matchAll(/<@&(\d+)>/g)].map((m) => m[1]))
      assert.ok(
        post.content.includes(`<@&${id}>`),
        `${name}: role ${id} is drawn in the embed but never pinged in the content`,
      );
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
  const post = seriesSubmittedPost({ ...submitted, oppPing: null, homeWins: 3, awayWins: 0 });
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

test("the intro draws each team as its role, falling back to bold when there is none", () => {
  for (const post of [
    tournamentIntroPost(introTeams, { name: "crl-abc", password: "hunter2" }, true),
    seasonIntroPost(introTeams, 1, { lines: "soon", coordinate: "- Coordinate." }, "<#1>"),
  ])
    assert.equal(post.embeds[0].description, "<@&100>  vs  <@&200>");

  const unrostered = tournamentIntroPost(
    { ...introTeams, awayName: "Unrostered FC", awayPing: teamPing("Unrostered FC", ROLES) },
    { name: "crl-abc", password: "hunter2" },
    true,
  );
  assert.equal(unrostered.embeds[0].description, "<@&100>  vs  **Unrostered FC**");

  const lobbyOf = (p: ChannelPost) => p.embeds[0].fields!.find((f) => f.name === "Lobby")!.value;
  assert.ok(lobbyOf(tournamentIntroPost(introTeams, { name: "crl-abc", password: "hunter2" }, true))
    .startsWith("<@&200> makes the lobby"));
  assert.ok(lobbyOf(unrostered).startsWith("**Unrostered FC** makes the lobby"));
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

test("the submitted embed names the winner, the loser and the series score", () => {
  // Home and away are passed through, not reporter-relative: the reporter can be
  // the losing team, and the embed has to read the same either way.
  const homeWon = seriesSubmittedPost({ ...submitted, homeWins: 3, awayWins: 1 });
  assert.equal(
    homeWon.embeds[0].description,
    "**Top Tier** beat **We Have The Meats** **3–1**.\nReported by **Top Tier**.",
  );

  const awayWon = seriesSubmittedPost({ ...submitted, teamName: "We Have The Meats", homeWins: 1, awayWins: 3 });
  assert.equal(
    awayWon.embeds[0].description,
    "**We Have The Meats** beat **Top Tier** **3–1**.\nReported by **We Have The Meats**.",
  );
});

test("an unmatched player warns the other team in the language of the active mode", () => {
  const clean = seriesSubmittedPost({ ...submitted, homeWins: 3, awayWins: 1 });
  assert.equal(clean.embeds[0].fields, undefined);

  const loose = seriesSubmittedPost({
    ...submitted, homeWins: 3, awayWins: 1,
    unmatchedNames: ["Rando", "Rando", "Ghost"],
    replayAnalysisMode: "loose",
  });
  const looseField = loose.embeds[0].fields![0];
  // Loose submits anyway, so the warning is the only thing standing between a
  // wrong replay and an approval — it has to tell them to look before approving.
  assert.ok(looseField.value.includes("Make sure these are the right replays"));
  assert.ok(looseField.value.includes("`Rando`") && looseField.value.includes("`Ghost`"));
  // One name per player, however many games they appeared in.
  assert.equal(looseField.value.match(/`Rando`/g)!.length, 1);
  assert.notEqual(loose.embeds[0].color, clean.embeds[0].color);

  const strict = seriesSubmittedPost({
    ...submitted, homeWins: 3, awayWins: 1,
    unmatchedNames: ["Rando"],
    replayAnalysisMode: "strict",
  });
  assert.ok(strict.embeds[0].fields![0].value.includes("admin"));
  assert.notEqual(strict.embeds[0].fields![0].name, looseField.name);
});

test("a replay display name can't draw a mention or a chip", () => {
  // A player can name their Rocket League account anything, and an unmatched name
  // is by definition one we don't control. Neither notifies anyone from inside an
  // embed, but `<@&100>` would render as a real team's chip and `@everyone` as the
  // server-wide one, so the message would read as something the bot said.
  const post = seriesSubmittedPost({
    ...submitted, homeWins: 3, awayWins: 0,
    unmatchedNames: ["@everyone", "<@&100>"],
    replayAnalysisMode: "loose",
  });
  const value = post.embeds[0].fields![0].value;
  assert.ok(!value.includes("@everyone"));
  assert.ok(!value.includes("<@&100>"));
  // Still legible — a zero-width space, not a deletion.
  assert.ok(value.includes("everyone") && value.includes("100"));
  // And the backtick wrapping survives, so the name can't close its own code span.
  const ticks = seriesSubmittedPost({
    ...submitted, homeWins: 3, awayWins: 0,
    unmatchedNames: ["a`b"],
    replayAnalysisMode: "loose",
  });
  assert.ok(ticks.embeds[0].fields![0].value.includes("`a'b`"));
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
