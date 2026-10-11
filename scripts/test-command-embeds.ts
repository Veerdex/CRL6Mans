import { test } from "node:test";
import assert from "node:assert/strict";

import {
  avatarUrl,
  profileEmbed,
  statsEmbed,
  coinsEmbed,
  subAckEmbed,
  decisionAckEmbed,
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
