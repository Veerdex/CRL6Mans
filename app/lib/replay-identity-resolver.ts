import type { ReplayPlatform, IdentitySource, PlayerStat } from "@/app/lib/replay-parser";
import { normalizeName } from "@/app/lib/tracker-name";

// Shared identity resolver (Platform-Account Identity Enforcement, Step 6).
//
// Pure function, no DB access, no side effects — callers fetch the data and
// pass it in. This is deliberately shadow-mode only right now: it classifies
// each replay participant but nothing yet blocks on the result. Steps 6 and 7
// (discrepancy persistence + hard block) must ship atomically per the plan,
// so results here are informational until that lands.
//
// The one rule this file exists to enforce: a trusted platform ID is never
// routed through name matching, and a name match never certifies an identity
// a trusted ID contradicts. Untrusted/missing IDs may only ever produce a
// suggestion for admin review (unverifiable-identity / ambiguous-name).

export type ExpectedTeam = "home" | "away";

export type ExpectedPlayer = {
  playerId: string;
  team: ExpectedTeam;
};

export type VerifiedAccountRecord = {
  playerId: string;
  platform: ReplayPlatform;
  platformAccountId: string;
  verifiedDisplayName: string | null;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
};

export type IdentityResolutionType =
  | "matched-by-platform-id"
  | "unexpected-account"
  | "id-owned-by-other-player"
  | "ineligible-player"
  | "wrong-team"
  | "duplicate-player"
  | "missing-expected-player"
  | "unverifiable-identity"
  | "unsupported-platform"
  | "late-account-registration"
  | "ambiguous-name";

export type PlayerResolution = {
  replayName: string;
  replayTeam: 0 | 1;
  platform: ReplayPlatform | null;
  onlineId: string | null;
  identitySource: IdentitySource | null;
  type: IdentityResolutionType;
  playerId: string | null;
  conflictingPlayerId: string | null;
  expectedTeam: ExpectedTeam | null;
  displayNameChanged: boolean;
  reason: string;
};

export type ResolveReplayParticipantsInput = {
  replayPlayers: PlayerStat[];
  // null when there is no match to anchor to (analyzeReplayFile's standalone tester).
  expectedLineup: ExpectedPlayer[] | null;
  // Subset of expectedLineup player IDs that are currently eligible (e.g. still
  // `approved`, not since kicked/banned). Only meaningful when expectedLineup is set.
  currentlyEligiblePlayerIds: Set<string>;
  // Required whenever expectedLineup is set — verified-account validity is checked
  // against this instant, never against upload time.
  kickoffAt: string | null;
  // Verified accounts (status verified OR revoked — revoked rows still carry the
  // validity window that mattered at kickoff) touching the platform IDs seen in
  // this replay. Fetch broadly; this function applies the validity window itself.
  globalVerifiedAccounts: VerifiedAccountRecord[];
};

export type ResolveReplayParticipantsResult = {
  players: PlayerResolution[];
  missingExpectedPlayers: ExpectedPlayer[];
};

const TRUSTED_SOURCES: ReadonlySet<IdentitySource> = new Set(["header", "network"]);

// Types worth surfacing in shadow-mode logs before verification adoption is
// widespread. "unverifiable-identity" and "ineligible-player" are excluded
// deliberately — pre-rollout, almost no account is verified yet, so those
// fire on nearly every upload and would bury real anomalies in noise.
export const SUSPICIOUS_RESOLUTION_TYPES: ReadonlySet<IdentityResolutionType> = new Set([
  "unexpected-account",
  "id-owned-by-other-player",
  "wrong-team",
  "duplicate-player",
  "late-account-registration",
]);

function isAccountValidAt(account: VerifiedAccountRecord, atIso: string): boolean {
  const at = new Date(atIso).getTime();
  if (at < new Date(account.validFrom).getTime()) return false;
  if (account.validUntil && at >= new Date(account.validUntil).getTime()) return false;
  if (account.revokedAt && at >= new Date(account.revokedAt).getTime()) return false;
  return true;
}

export function resolveReplayParticipants(
  input: ResolveReplayParticipantsInput,
): ResolveReplayParticipantsResult {
  const { replayPlayers, expectedLineup, currentlyEligiblePlayerIds, kickoffAt, globalVerifiedAccounts } = input;

  const expectedTeamById = new Map<string, ExpectedTeam>();
  for (const e of expectedLineup ?? []) expectedTeamById.set(e.playerId, e.team);

  type Draft = PlayerResolution & { _ownerId: string | null };
  const drafts: Draft[] = [];

  for (const p of replayPlayers) {
    const base = {
      replayName: p.name,
      replayTeam: p.team,
      platform: p.platform,
      onlineId: p.onlineId,
      identitySource: p.identitySource,
    };

    const isTrusted = p.identitySource !== null && TRUSTED_SOURCES.has(p.identitySource);

    if (!isTrusted) {
      drafts.push({
        ...base,
        type: "unverifiable-identity",
        playerId: null,
        conflictingPlayerId: null,
        expectedTeam: null,
        displayNameChanged: false,
        reason: p.identitySource === "bakkesmod"
          ? "Identity suggested by a BakkesMod trailer record only — admin-suggestion, not certification"
          : "No trusted platform identity present for this participant",
        _ownerId: null,
      });
      continue;
    }

    if (!p.platform || p.platform === "unknown" || !p.onlineId) {
      drafts.push({
        ...base,
        type: "unsupported-platform",
        playerId: null,
        conflictingPlayerId: null,
        expectedTeam: null,
        displayNameChanged: false,
        reason: "Platform could not be determined from this replay",
        _ownerId: null,
      });
      continue;
    }

    const owner = globalVerifiedAccounts.find(
      a => a.platform === p.platform && a.platformAccountId === p.onlineId,
    );

    if (!owner) {
      drafts.push({
        ...base,
        type: "unexpected-account",
        playerId: null,
        conflictingPlayerId: null,
        expectedTeam: null,
        displayNameChanged: false,
        reason: "No verified owner exists for this platform account",
        _ownerId: null,
      });
      continue;
    }

    const displayNameChanged = !!owner.verifiedDisplayName && normalizeName(owner.verifiedDisplayName) !== normalizeName(p.name);

    if (expectedLineup === null) {
      // No match context: report ownership only, never an eligibility verdict.
      drafts.push({
        ...base,
        type: "matched-by-platform-id",
        playerId: owner.playerId,
        conflictingPlayerId: null,
        expectedTeam: null,
        displayNameChanged,
        reason: "Resolved against global verified accounts (no match to check eligibility against)",
        _ownerId: owner.playerId,
      });
      continue;
    }

    if (!kickoffAt || !isAccountValidAt(owner, kickoffAt)) {
      drafts.push({
        ...base,
        type: "late-account-registration",
        playerId: owner.playerId,
        conflictingPlayerId: null,
        expectedTeam: expectedTeamById.get(owner.playerId) ?? null,
        displayNameChanged,
        reason: "Account was not verified and active as of kickoff",
        _ownerId: owner.playerId,
      });
      continue;
    }

    const expectedTeam = expectedTeamById.get(owner.playerId) ?? null;
    if (!expectedTeam) {
      drafts.push({
        ...base,
        type: "id-owned-by-other-player",
        playerId: owner.playerId,
        conflictingPlayerId: owner.playerId,
        expectedTeam: null,
        displayNameChanged,
        reason: "This platform account belongs to a verified player outside this match's eligible roster",
        _ownerId: owner.playerId,
      });
      continue;
    }

    if (!currentlyEligiblePlayerIds.has(owner.playerId)) {
      drafts.push({
        ...base,
        type: "ineligible-player",
        playerId: owner.playerId,
        conflictingPlayerId: null,
        expectedTeam,
        displayNameChanged,
        reason: "Player was expected but is no longer eligible (e.g. removed from active play)",
        _ownerId: owner.playerId,
      });
      continue;
    }

    // Tentatively a match — team-side is checked in the second pass below,
    // once we know which physical team each replay side (0/1) maps to.
    drafts.push({
      ...base,
      type: "matched-by-platform-id",
      playerId: owner.playerId,
      conflictingPlayerId: null,
      expectedTeam,
      displayNameChanged,
      reason: displayNameChanged ? "Display name changed since verification" : "Resolved by verified platform ID",
      _ownerId: owner.playerId,
    });
  }

  // Determine which replay team (0/1) is "home" by majority vote among
  // participants already confirmed to be an expected, eligible, on-time match.
  let team0Votes = 0;
  let team1Votes = 0;
  for (const d of drafts) {
    if (d.type !== "matched-by-platform-id" || !d.expectedTeam) continue;
    const votesHome = d.expectedTeam === "home";
    if (d.replayTeam === 0) (votesHome ? team0Votes++ : team1Votes++);
    else (votesHome ? team1Votes++ : team0Votes++);
  }
  const team0IsHome = expectedLineup === null ? null : team0Votes >= team1Votes;

  for (const d of drafts) {
    if (d.type !== "matched-by-platform-id" || !d.expectedTeam || team0IsHome === null) continue;
    const actualTeam: ExpectedTeam = (d.replayTeam === 0) === team0IsHome ? "home" : "away";
    if (actualTeam !== d.expectedTeam) {
      d.type = "wrong-team";
      d.reason = "Verified player appeared on the opposite side from their expected team";
    }
  }

  // Duplicate detection: the same owned player resolved from two replay slots.
  const seenOwners = new Set<string>();
  for (const d of drafts) {
    if (!d._ownerId) continue;
    if (seenOwners.has(d._ownerId)) {
      d.type = "duplicate-player";
      d.conflictingPlayerId = d._ownerId;
      d.reason = "This player's verified account was already matched to another slot in this replay";
    } else {
      seenOwners.add(d._ownerId);
    }
  }

  const matchedIds = new Set(
    drafts.filter(d => d.type === "matched-by-platform-id" || d.type === "wrong-team").map(d => d._ownerId!),
  );
  const missingExpectedPlayers = (expectedLineup ?? []).filter(e => !matchedIds.has(e.playerId));

  return {
    players: drafts.map(({ _ownerId, ...rest }) => rest),
    missingExpectedPlayers: expectedLineup === null ? [] : missingExpectedPlayers,
  };
}
