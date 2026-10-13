import { test } from "node:test";
import assert from "node:assert/strict";

import {
  avatarUrl,
  profileEmbed,
  statsEmbed,
  coinsEmbed,
  subAckEmbed,
  reportAckEmbed,
  reportRejectedEmbed,
  decisionAckEmbed,
  disputeAckEmbed,
  forfeitAckEmbed,
  type ProfileEmbedArgs,
  type StatsEmbedArgs,
} from "../app/lib/command-embeds";
import { mvpScore, shootingPct } from "../app/lib/stats-math";

const PROFILE: ProfileEmbedArgs = {
  username: "veerdex",
  displayName: "Veer",
  discordId: "123",
  avatar: "abc",
  teamName: "Top Tier",
  isCaptain: true,
  careerPoints: 420,
  rankValue: 1537,
  seasonPeak2v2: 1400,
  allTimePeak2v2: 1600,
  seasonPeak3v3: 1500,
  allTimePeak3v3: 1700,
};

const STATS: StatsEmbedArgs = {
  username: "veerdex",
  displayName: null,
  discordId: "123",
  avatar: null,
  teamName: "Top Tier",
  games: 10,
  goals: 20,
  assists: 10,
  saves: 15,
  shots: 40,
  score: 4000,
  demos: 7,
  demoed: 3,
  mvp: 0,
  shootingPct: 0,
};

const field = (e: { fields?: Array<{ name: string; value: string }> }, name: string) =>
  e.fields?.find((f) => f.name === name);

test("mvpScore matches the formula the stats table publishes", () => {
  // ((20+10+15+40÷10)÷(10×4)) + 4000÷10÷1000 = 1.225 + 0.4
  assert.equal(mvpScore({
    games: 10, totalGoals: 20, totalAssists: 10, totalSaves: 15, totalShots: 40, totalScore: 4000,
  }), 1.625);
  assert.equal(shootingPct({ totalGoals: 20, totalShots: 40 }), 50);
});

test("no recorded games is not a zero score", () => {
  assert.equal(mvpScore({
    games: 0, totalGoals: 0, totalAssists: 0, totalSaves: 0, totalShots: 0, totalScore: 0,
  }), 0);
  assert.equal(shootingPct({ totalGoals: 0, totalShots: 0 }), 0);
});

test("an unset peak reads as an em dash, never a confident zero", () => {
  const e = profileEmbed({ ...PROFILE, seasonPeak2v2: null, allTimePeak2v2: null, rankValue: null });
  assert.match(field(e, "2v2")!.value, /Season Peak: \*\*—\*\*/);
  assert.match(field(e, "2v2")!.value, /All-Time Peak: \*\*—\*\*/);
  assert.equal(field(e, "Rank Value")!.value, "—");
  // A measured zero still reads as zero.
  assert.equal(field(profileEmbed({ ...PROFILE, careerPoints: 0 }), "Career Points")!.value, "0");
});

test("profile shows season peak before all-time, both codes", () => {
  const e = profileEmbed(PROFILE);
  for (const code of ["2v2", "3v3"]) {
    const v = field(e, code)!.value;
    assert.ok(v.indexOf("Season Peak") < v.indexOf("All-Time Peak"), code);
  }
});

test("captaincy and roster state read off the description", () => {
  assert.match(profileEmbed(PROFILE).description!, /🧢 Captain of \*\*Top Tier\*\*/);
  assert.match(profileEmbed({ ...PROFILE, isCaptain: false }).description!, /^Playing for \*\*Top Tier\*\*$/);
  assert.match(profileEmbed({ ...PROFILE, teamName: null, isCaptain: false }).description!, /Not currently on a team/);
});

test("an avatar hash becomes a thumbnail, and its absence omits one", () => {
  assert.equal(avatarUrl("123", null), null);
  assert.match(avatarUrl("123", "abc")!, /\/avatars\/123\/abc\.png\?size=128$/);
  // Animated hashes are prefixed a_ and only render as .gif.
  assert.match(avatarUrl("123", "a_abc")!, /\.gif\?size=128$/);
  assert.equal(profileEmbed({ ...PROFILE, avatar: null }).thumbnail, undefined);
  assert.ok(profileEmbed(PROFILE).thumbnail);
});

test("a player with no games gets no table of zeroes", () => {
  const e = statsEmbed({ ...STATS, games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0, demos: 0, demoed: 0 });
  assert.equal(e.fields, undefined);
  assert.match(e.description!, /No recorded games yet/);
});

test("stats fields are rounded to a fixed width", () => {
  const e = statsEmbed({ ...STATS, mvp: mvpScore({
    games: 10, totalGoals: 20, totalAssists: 10, totalSaves: 15, totalShots: 40, totalScore: 4000,
  }), shootingPct: 50 });
  // Locale decides the separator, so the assertion is on the digit count.
  assert.match(field(e, "MVP Score")!.value, /^\d+[.,]\d{3}$/);
  assert.match(field(e, "Shooting %")!.value, /^\d+[.,]\d%$/);
  assert.match(field(e, "Per Game")!.value, /Goals: \*\*\d+[.,]\d{2}\*\*/);
  assert.match(field(e, "Demos")!.value, /Dealt: \*\*7\*\*/);
});

test("a coin rank only appears when both halves of it are known", () => {
  const base = { username: "veerdex", displayName: null, discordId: "123", avatar: null, coins: 1500 };
  assert.equal(coinsEmbed({ ...base, rank: null, totalRanked: 40 }).fields, undefined);
  assert.equal(coinsEmbed({ ...base, rank: 3, totalRanked: null }).fields, undefined);
  assert.match(field(coinsEmbed({ ...base, rank: 3, totalRanked: 40 }), "Leaderboard")!.value, /3.*40/);
});

test("a decision embed names what it decided and colours it", () => {
  const ok = decisionAckEmbed({ target: "sub", approved: true, detail: "x" });
  const no = decisionAckEmbed({ target: "series", approved: false, detail: "x" });
  assert.equal(ok.title, "Substitution approved");
  assert.equal(no.title, "Series result rejected");
  assert.notEqual(ok.color, no.color);
});

test("a dispute embed reads as escalated, not as a refusal", () => {
  // The colour carries the whole meaning here: a rejection and an escalation are
  // both "bad news" to a player, and a dispute sharing red with /reject would say
  // staff had turned them down rather than taken it on.
  const sub = disputeAckEmbed({ target: "sub", detail: "x" });
  const series = disputeAckEmbed({ target: "series", detail: "x" });
  assert.equal(sub.title, "Substitution sent to staff");
  assert.equal(series.title, "Series result sent to staff");
  assert.notEqual(sub.color, decisionAckEmbed({ target: "sub", approved: false, detail: "x" }).color);
  assert.notEqual(sub.color, decisionAckEmbed({ target: "sub", approved: true, detail: "x" }).color);
});

test("a dispute detail is clamped like every other player-facing description", () => {
  const e = disputeAckEmbed({ target: "series", detail: "x".repeat(5000) });
  assert.ok(e.description!.length <= 4096);
});

test("a sub acknowledgement omits the reason field when none was given", () => {
  const args = { teamName: "Top Tier", playerOut: "a", subIn: "b", oppName: "We Have The Meats", reason: null };
  assert.equal(subAckEmbed(args).fields, undefined);
  assert.match(field(subAckEmbed({ ...args, reason: "sick" }), "Reason given")!.value, /^sick$/);
});

test("player-supplied text is clamped, never allowed to 400 the message", () => {
  const long = "x".repeat(5000);
  const e = profileEmbed({ ...PROFILE, teamName: long, username: long, displayName: null });
  assert.ok(e.title!.length <= 256, `title ${e.title!.length}`);
  for (const f of e.fields!) assert.ok(f.value.length <= 1024, f.name);
  assert.ok(e.description!.length <= 4096);

  const s = statsEmbed({ ...STATS, username: long, teamName: long, mvp: 1, shootingPct: 1 });
  assert.ok(s.title!.length <= 256);
  for (const f of s.fields!) assert.ok(f.value.length <= 1024, f.name);

  const sub = subAckEmbed({ teamName: long, playerOut: long, subIn: long, oppName: long, reason: long });
  assert.ok(sub.description!.length <= 4096);
  assert.ok(sub.fields![0].value.length <= 1024);
  assert.ok(decisionAckEmbed({ target: "sub", approved: true, detail: long }).description!.length <= 4096);
});

const REPORTED = {
  homeName: "Top Tier",
  awayName: "We Have The Meats",
  oppName: "We Have The Meats",
};

test("the report acknowledgement reads the winner off home/away, not off the reporter", () => {
  // The losing team can be the one that reports, so the ack cannot assume the
  // caller won — and it has to agree with the public embed either way.
  assert.match(
    reportAckEmbed({ ...REPORTED, homeWins: 3, awayWins: 1 }).description!,
    /^\*\*Top Tier\*\* beat \*\*We Have The Meats\*\* \*\*3–1\*\*\.$/,
  );
  assert.match(
    reportAckEmbed({ ...REPORTED, homeWins: 1, awayWins: 3 }).description!,
    /^\*\*We Have The Meats\*\* beat \*\*Top Tier\*\* \*\*3–1\*\*\.$/,
  );
  assert.match(
    reportAckEmbed({ ...REPORTED, homeWins: 3, awayWins: 1 }).footer!.text,
    /^We Have The Meats has been notified/,
  );
});

test("the report acknowledgement only mentions unmatched players when there were some", () => {
  const clean = reportAckEmbed({ ...REPORTED, homeWins: 3, awayWins: 0 });
  assert.equal(clean.fields, undefined);

  const loose = reportAckEmbed({
    ...REPORTED, homeWins: 3, awayWins: 0, unmatchedNames: ["Rando", "Rando"],
  });
  // One entry per player however many games they turned up in.
  assert.equal(loose.fields![0].value.match(/`Rando`/g)!.length, 1);
  assert.notEqual(loose.color, clean.color);
});

test("a rejection says what went wrong and that nothing was saved", () => {
  const e = reportRejectedEmbed({ problem: "These replays add up to 2–1." });
  assert.equal(e.title, "Series not reported");
  assert.equal(e.description, "These replays add up to 2–1.");
  assert.equal(e.fields, undefined);
  assert.match(e.footer!.text, /Nothing was saved/);
  assert.notEqual(e.color, reportAckEmbed({ ...REPORTED, homeWins: 3, awayWins: 0 }).color);

  // An unmatched name is the one rejection a reporter can't fix by retyping, so
  // it names the players and points at the two ways out.
  const unmatched = reportRejectedEmbed({
    problem: "Some players couldn't be matched.",
    unmatchedNames: ["Rando"],
  });
  assert.ok(unmatched.fields![0].value.includes("`Rando`"));
  assert.ok(unmatched.fields![0].value.includes("tracker"));
  assert.ok(unmatched.fields![0].value.includes("My Team"));
});

test("a replay display name can't draw a mention or a chip in a report embed", () => {
  // Unlike a username or a team name, this string is not league data: it is what
  // that player typed into Rocket League, and an unmatched one is nobody we know.
  for (const e of [
    reportAckEmbed({ ...REPORTED, homeWins: 3, awayWins: 0, unmatchedNames: ["@everyone", "<@&100>"] }),
    reportRejectedEmbed({ problem: "x", unmatchedNames: ["@everyone", "<@&100>"] }),
  ]) {
    const value = e.fields![0].value;
    assert.ok(!value.includes("@everyone"), value);
    assert.ok(!value.includes("<@&100>"), value);
    // Still legible — a zero-width space, not a deletion.
    assert.ok(value.includes("everyone") && value.includes("100"));
  }
  // And a backtick in the name can't close the code span it is wrapped in.
  const ticks = reportRejectedEmbed({ problem: "x", unmatchedNames: ["a`b"] });
  assert.ok(ticks.fields![0].value.includes("`a'b`"));
});

test("report embeds clamp every part that a long name could blow", () => {
  const long = "x".repeat(5000);
  const ack = reportAckEmbed({
    homeName: long, awayName: long, oppName: long, homeWins: 3, awayWins: 0,
    unmatchedNames: [long],
  });
  assert.ok(ack.description!.length <= 4096);
  assert.ok(ack.footer!.text.length <= 2048);
  assert.ok(ack.fields![0].value.length <= 1024);

  const rejected = reportRejectedEmbed({ problem: long, unmatchedNames: [long, long + "y"] });
  assert.ok(rejected.description!.length <= 4096);
  assert.ok(rejected.fields![0].value.length <= 1024);
});

test("a builder returns a bare embed, so no ping can hide inside one", () => {
  // These are command replies: the caller sends them with empty content, which
  // is the only place a mention would resolve. A team named @everyone therefore
  // lands in the embed as inert text rather than as a ping — the opposite of
  // match-embeds.ts, where the name is kept out of content entirely.
  const e = profileEmbed({ ...PROFILE, teamName: "@everyone" });
  assert.ok(!("content" in e));
  assert.ok(!("allowed_mentions" in e));
  assert.match(e.description!, /@everyone/);
});

test("each forfeit outcome is a visibly different answer", () => {
  const args = { teamName: "Top Tier", oppName: "We Have The Meats", votes: 1, required: 2 };
  const counted = forfeitAckEmbed({ ...args, state: "counted" });
  const already = forfeitAckEmbed({ ...args, state: "already" });
  const withdrawn = forfeitAckEmbed({ ...args, state: "withdrawn", votes: 0 });
  const done = forfeitAckEmbed({ ...args, state: "forfeited", votes: 2 });

  // The titles are the whole point: a repeat press must not read as a second
  // vote having landed, and a landed forfeit must not read like a vote.
  const titles = [counted, already, withdrawn, done].map((e) => e.title);
  assert.equal(new Set(titles).size, 4);
  assert.match(already.title!, /already/i);
  assert.match(done.title!, /forfeited/i);

  // A vote that didn't decide anything says so, so nobody re-runs it to check.
  assert.match(counted.description!, /1 of 2/);
  assert.match(counted.description!, /still on/i);
  assert.match(already.description!, /1 of 2/);
  assert.match(already.description!, /won't add a second/i);

  // Only the terminal one is red; the others haven't ended anything.
  assert.notEqual(counted.color, done.color);
  assert.notEqual(withdrawn.color, done.color);
});

test("the forfeit ack clamps the team names a roster can supply", () => {
  const long = "x".repeat(5000);
  const e = forfeitAckEmbed({ state: "forfeited", teamName: long, oppName: long, votes: 2, required: 2 });
  assert.ok(e.description!.length <= 4096);
  assert.ok(e.footer!.text.length <= 2048);
});
