// Unit tests for app/lib/replay-parser.ts pure-logic helpers.
//
// No .replay fixture files exist in the repo, so this suite deliberately does
// NOT hand-build synthetic binary replay buffers to exercise parseReplay's
// property-map decoding — a fixture built by re-deriving the encoder from the
// decoder only proves the two agree with each other, not that either matches
// a real Rocket League replay. What it CAN safely check without real bytes:
// normalisePlatform's string/enum mapping, mergeNetworkIdentities' conflict
// and ambiguity handling, and parseReplay's buffer-size guards (which run
// before any header bytes are interpreted).
//
// Full-parse acceptance scenarios (exact SteamID64 precision from real bytes,
// PlayStation numeric ID, Epic ID stability across supplied replays, PsyNet
// distinctness, BakkesMod ambiguity refusal) require real .replay files and
// should be verified through the /dashboard/test-replay admin UI once
// fixtures are available.
//
// Run with: npm run test:replay-parser

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalisePlatform,
  mergeNetworkIdentities,
  leaversFromNetwork,
  lobbyCheck,
  parseReplay,
  ReplayParseError,
  type PlayerStat,
  type ReplayData,
} from "../app/lib/replay-parser";
import type { NetworkPlayer } from "../app/lib/replay-network-parser";

test("normalisePlatform recognizes each platform's enum/string forms", () => {
  assert.equal(normalisePlatform("OnlinePlatform_Steam"), "steam");
  assert.equal(normalisePlatform("OnlinePlatform_PS4"), "playstation");
  assert.equal(normalisePlatform("OnlinePlatform_PS5"), "playstation");
  assert.equal(normalisePlatform("OnlinePlatform_Dingo"), "xbox");
  assert.equal(normalisePlatform("OnlinePlatform_Switch"), "switch");
  assert.equal(normalisePlatform("OnlinePlatform_Epic"), "epic");
});

test("normalisePlatform never merges PsyNet into PlayStation", () => {
  const psynet = normalisePlatform("OnlinePlatform_PsyNet");
  const playstation = normalisePlatform("OnlinePlatform_PS4");
  assert.equal(psynet, "psynet");
  assert.equal(playstation, "playstation");
  assert.notEqual(psynet, playstation);
});

test("normalisePlatform accepts ByteProperty-shaped values", () => {
  assert.equal(
    normalisePlatform({ enumType: "EOnlinePlatform", enumValue: "OnlinePlatform_Steam" }),
    "steam",
  );
  assert.equal(
    normalisePlatform({ enumType: "OnlinePlatform_PsyNet", enumValue: "None" }),
    "psynet",
  );
});

test("normalisePlatform returns null for absent/unrecognizable input", () => {
  assert.equal(normalisePlatform(undefined), null);
  assert.equal(normalisePlatform(""), null);
  assert.equal(normalisePlatform(42), null);
});

function basePlayer(overrides: Partial<PlayerStat> = {}): PlayerStat {
  return {
    name: "Player",
    team: 0,
    score: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    demoed: 0,
    platform: null,
    onlineId: null,
    identityKey: null,
    identitySource: null,
    ...overrides,
  };
}

function baseReplay(players: PlayerStat[]): ReplayData {
  return {
    team0Score: 0,
    team1Score: 0,
    players,
    date: null,
    mapName: null,
    replayId: null,
    gameType: "TAGame.Replay_Soccar_TA",
    majorVersion: 0,
    minorVersion: 0,
    netVersion: null,
    warnings: [],
  };
}

test("mergeNetworkIdentities assigns a unique unambiguous match", () => {
  const replay = baseReplay([basePlayer({ name: "Aerose-" })]);
  const merged = mergeNetworkIdentities(replay, [
    { name: "Aerose-", team: 0, platform: "playstation", onlineId: "1234567890123456789" },
  ]);
  assert.equal(merged.players[0].platform, "playstation");
  // Preserved as a decimal string end-to-end: a numeric ID this long loses
  // trailing-digit precision the instant it's coerced to a JS number.
  assert.equal(merged.players[0].onlineId, "1234567890123456789");
  assert.equal(merged.players[0].identityKey, "playstation:1234567890123456789");
  assert.equal(merged.players[0].identitySource, "network");
  assert.equal(merged.warnings.length, 0);
});

test("mergeNetworkIdentities refuses ambiguous name matches", () => {
  const replay = baseReplay([basePlayer({ name: "camwin" })]);
  const merged = mergeNetworkIdentities(replay, [
    { name: "camwin", platform: "steam", onlineId: "111" },
    { name: "camwin", platform: "steam", onlineId: "222" },
  ]);
  assert.equal(merged.players[0].identityKey, null);
  assert.ok(merged.warnings.some(w => w.includes("Ambiguous")));
});

test("mergeNetworkIdentities never overwrites a conflicting header identity", () => {
  const replay = baseReplay([
    basePlayer({
      name: "camwin",
      platform: "steam",
      onlineId: "76561198220214291",
      identityKey: "steam:76561198220214291",
      identitySource: "header",
    }),
  ]);
  const merged = mergeNetworkIdentities(replay, [
    { name: "camwin", platform: "steam", onlineId: "1" },
  ]);
  assert.equal(merged.players[0].identityKey, "steam:76561198220214291");
  assert.equal(merged.players[0].identitySource, "header");
  assert.ok(merged.warnings.some(w => w.includes("conflict")));
});

function netPlayer(overrides: Partial<NetworkPlayer> = {}): NetworkPlayer {
  return {
    name: "Leaver", team: 1, bot: false, score: 105, goals: 0, assists: 0, saves: 1, shots: 1,
    platformKind: "Steam", onlineId: "76561198199134390", ...overrides,
  };
}

test("leaversFromNetwork recovers a player missing from the header", () => {
  const [leaver] = leaversFromNetwork([basePlayer({ name: "Stayed", score: 200 })], [netPlayer()]);
  assert.equal(leaver.name, "Leaver");
  assert.equal(leaver.team, 1);
  assert.equal(leaver.score, 105);
  assert.equal(leaver.saves, 1);
  assert.equal(leaver.leftEarly, true);
  assert.equal(leaver.identityKey, "steam:76561198199134390");
  assert.equal(leaver.identitySource, "network");
});

test("leaversFromNetwork skips header players, bots, casters and teamless PRIs", () => {
  const leavers = leaversFromNetwork([basePlayer({ name: "Stayed", score: 200 })], [
    netPlayer({ name: "Stayed" }),
    netPlayer({ name: "Bot", bot: true }),
    netPlayer({ name: "Caster", score: 0 }),
    netPlayer({ name: "Spectator", team: null }),
  ]);
  assert.deepEqual(leavers, []);
});

test("leaversFromNetwork keeps the highest-scoring PRI of a repeated leaver", () => {
  const leavers = leaversFromNetwork([], [netPlayer({ score: 40 }), netPlayer({ score: 150 })]);
  assert.equal(leavers.length, 1);
  assert.equal(leavers[0].score, 150);
});

test("leaversFromNetwork maps the network platform kinds", () => {
  const [ps] = leaversFromNetwork([], [netPlayer({ platformKind: "PlayStation", onlineId: "209535737892745380" })]);
  assert.equal(ps.identityKey, "playstation:209535737892745380");
  const [none] = leaversFromNetwork([], [netPlayer({ platformKind: null, onlineId: null })]);
  assert.equal(none.identityKey, null);
  assert.equal(none.identitySource, null);
});

const side = (team: 0 | 1, finishers: number, leavers = 0) => [
  ...Array.from({ length: finishers }, (_, i) => basePlayer({ name: `t${team}f${i}`, team, score: 100 })),
  ...Array.from({ length: leavers }, (_, i) => basePlayer({ name: `t${team}l${i}`, team, score: 100, leftEarly: true })),
];

test("lobbyCheck accepts a full lobby and a side short only by a leaver", () => {
  assert.equal(lobbyCheck([...side(0, 3), ...side(1, 3)], 3).valid, true);
  assert.equal(lobbyCheck([...side(0, 3), ...side(1, 2, 1)], 3).valid, true);
  assert.equal(lobbyCheck([...side(0, 1), ...side(1, 0, 1)], 1).valid, true);
});

test("lobbyCheck accepts a leaver replaced mid-game", () => {
  assert.equal(lobbyCheck([...side(0, 3), ...side(1, 3, 1)], 3).valid, true);
});

test("lobbyCheck rejects a short lobby and an oversized side", () => {
  const short = lobbyCheck([...side(0, 2), ...side(1, 2)], 3);
  assert.equal(short.valid, false);
  assert.equal(short.blueFinishers, 2);
  assert.equal(lobbyCheck([...side(0, 3), ...side(1, 1, 1)], 3).valid, false);
  assert.equal(lobbyCheck([...side(0, 4), ...side(1, 3)], 3).valid, false);
});

test("parseReplay rejects buffers too small to contain a header", () => {
  assert.throws(() => parseReplay(Buffer.alloc(10)), ReplayParseError);
});

test("parseReplay rejects buffers over the safety size limit", () => {
  const oversized = Buffer.alloc(64 * 1024 * 1024 + 1);
  assert.throws(() => parseReplay(oversized), ReplayParseError);
});

test("parseReplay rejects a header whose declared size overruns the buffer", () => {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0xffffff, 0); // declared header_size far past actual length
  buf.writeUInt32LE(0, 4); // header_crc
  assert.throws(() => parseReplay(buf), ReplayParseError);
});
