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
  parseReplay,
  ReplayParseError,
  type PlayerStat,
  type ReplayData,
} from "../app/lib/replay-parser";

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
