// Unit tests for app/lib/replay-identity-resolver.ts against the plan's own
// acceptance scenarios (Platform-Account Identity Enforcement, Step 6).
//
// resolveReplayParticipants is a pure function, so these run against
// hand-built inputs — no .replay fixtures needed.
//
// Run with: npm run test:replay-identity-resolver

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveReplayParticipants } from "../app/lib/replay-identity-resolver";
import type { PlayerStat } from "../app/lib/replay-parser";
import type { ExpectedPlayer, VerifiedAccountRecord } from "../app/lib/replay-identity-resolver";

const KICKOFF = "2026-01-01T18:00:00.000Z";

function player(overrides: Partial<PlayerStat>): PlayerStat {
  return {
    name: "Player",
    team: 0,
    score: 300,
    goals: 1,
    assists: 0,
    saves: 0,
    shots: 1,
    demos: 0,
    demoed: 0,
    platform: "steam",
    onlineId: "1",
    identityKey: "steam:1",
    identitySource: "header",
    ...overrides,
  };
}

function account(overrides: Partial<VerifiedAccountRecord>): VerifiedAccountRecord {
  return {
    playerId: "p1",
    platform: "steam",
    platformAccountId: "1",
    verifiedDisplayName: null,
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: null,
    revokedAt: null,
    ...overrides,
  };
}

const homeAway = (homeIds: string[], awayIds: string[]): ExpectedPlayer[] => [
  ...homeIds.map(playerId => ({ playerId, team: "home" as const })),
  ...awayIds.map(playerId => ({ playerId, team: "away" as const })),
];

test("renamed player with correct trusted ID matches and flags displayNameChanged", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({ name: "NewName" })],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({ verifiedDisplayName: "OldName" })],
  });
  assert.equal(result.players[0].type, "matched-by-platform-id");
  assert.equal(result.players[0].playerId, "p1");
  assert.equal(result.players[0].displayNameChanged, true);
});

test("matching name with no verified ID never certifies via name fallback", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({ name: "Expected Player", identitySource: null, platform: null, onlineId: null })],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [],
  });
  assert.equal(result.players[0].type, "unverifiable-identity");
  assert.equal(result.players[0].playerId, null);
});

test("ID registered to another player blocks as id-owned-by-other-player", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({})],
    expectedLineup: homeAway(["p2"], []),
    currentlyEligiblePlayerIds: new Set(["p2"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({ playerId: "p1" })],
  });
  assert.equal(result.players[0].type, "id-owned-by-other-player");
  assert.equal(result.players[0].conflictingPlayerId, "p1");
});

test("verified player on the wrong replay side blocks as wrong-team", () => {
  // p1-p3 (home) correctly on team0, p4-p5 (away) correctly on team1 — a
  // clear majority anchoring team0 as home — and p6 (away) misplayed on
  // team0, which the vote should catch as the outlier, not the majority.
  const result = resolveReplayParticipants({
    replayPlayers: [
      player({ name: "P1", team: 0, onlineId: "1" }),
      player({ name: "P2", team: 0, onlineId: "2" }),
      player({ name: "P3", team: 0, onlineId: "3" }),
      player({ name: "P4", team: 1, onlineId: "4" }),
      player({ name: "P5", team: 1, onlineId: "5" }),
      player({ name: "SidedWrong", team: 0, onlineId: "6" }),
    ],
    expectedLineup: homeAway(["p1", "p2", "p3"], ["p4", "p5", "p6"]),
    currentlyEligiblePlayerIds: new Set(["p1", "p2", "p3", "p4", "p5", "p6"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [
      account({ playerId: "p1", platformAccountId: "1" }),
      account({ playerId: "p2", platformAccountId: "2" }),
      account({ playerId: "p3", platformAccountId: "3" }),
      account({ playerId: "p4", platformAccountId: "4" }),
      account({ playerId: "p5", platformAccountId: "5" }),
      account({ playerId: "p6", platformAccountId: "6" }),
    ],
  });
  const swap = result.players.find(p => p.replayName === "SidedWrong")!;
  assert.equal(swap.type, "wrong-team");
  const p1 = result.players.find(p => p.replayName === "P1")!;
  assert.equal(p1.type, "matched-by-platform-id");
});

test("account verified after kickoff blocks as late-account-registration", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({})],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({ validFrom: "2026-06-01T00:00:00.000Z" })],
  });
  assert.equal(result.players[0].type, "late-account-registration");
});

test("revoked account matches within its validity window, blocks after revocation", () => {
  const before = resolveReplayParticipants({
    replayPlayers: [player({})],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: "2026-02-01T00:00:00.000Z",
    globalVerifiedAccounts: [account({ revokedAt: "2026-03-01T00:00:00.000Z" })],
  });
  assert.equal(before.players[0].type, "matched-by-platform-id");

  const after = resolveReplayParticipants({
    replayPlayers: [player({})],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: "2026-04-01T00:00:00.000Z",
    globalVerifiedAccounts: [account({ revokedAt: "2026-03-01T00:00:00.000Z" })],
  });
  assert.equal(after.players[0].type, "late-account-registration");
});

test("BakkesMod-only identity is admin-suggestion only, never certifies", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({ identitySource: "bakkesmod" })],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({})],
  });
  assert.equal(result.players[0].type, "unverifiable-identity");
});

test("duplicate replay slots resolving to the same verified owner both flag duplicate-player", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [
      player({ name: "Slot A", onlineId: "1" }),
      player({ name: "Slot B", onlineId: "1" }),
    ],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({})],
  });
  assert.equal(result.players[0].type, "matched-by-platform-id");
  assert.equal(result.players[1].type, "duplicate-player");
  assert.equal(result.players[1].conflictingPlayerId, "p1");
});

test("expected player who never appears is reported in missingExpectedPlayers", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [],
  });
  assert.deepEqual(result.missingExpectedPlayers, [{ playerId: "p1", team: "home" }]);
});

test("expectedLineup null (standalone tester) reports ownership only, never eligibility", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({})],
    expectedLineup: null,
    currentlyEligiblePlayerIds: new Set(),
    kickoffAt: null,
    globalVerifiedAccounts: [account({})],
  });
  assert.equal(result.players[0].type, "matched-by-platform-id");
  assert.equal(result.players[0].expectedTeam, null);
  assert.deepEqual(result.missingExpectedPlayers, []);
});

test("ineligible expected player (e.g. kicked since) blocks as ineligible-player", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({})],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({})],
  });
  assert.equal(result.players[0].type, "ineligible-player");
});

test("PsyNet account never matches a PlayStation-platform account for the same ID string", () => {
  const result = resolveReplayParticipants({
    replayPlayers: [player({ platform: "psynet", onlineId: "42" })],
    expectedLineup: homeAway(["p1"], []),
    currentlyEligiblePlayerIds: new Set(["p1"]),
    kickoffAt: KICKOFF,
    globalVerifiedAccounts: [account({ platform: "playstation", platformAccountId: "42" })],
  });
  assert.equal(result.players[0].type, "unexpected-account");
});
