// The verification-method label is audit metadata only — no code path branches
// on it — so it's derived from the account's platform rather than collected
// from the admin. See DEFAULT_METHOD_BY_PLATFORM in platform-account-claim-card.
const DEFAULT_METHOD_BY_PLATFORM: Record<string, string> = {
  steam: "legacy_manual",
  epic: "official_account_page",
  playstation: "console_replay_network",
  xbox: "console_replay_network",
  switch: "console_replay_network",
};

export function defaultVerificationMethod(platform: string): string {
  return DEFAULT_METHOD_BY_PLATFORM[platform] ?? "legacy_manual";
}

// verified_by is not null on a verified row and holds the verifying admin's
// discord_id; a claim verified with approval switched off has no admin, so it
// carries this marker instead.
export const AUTO_APPROVAL_VERIFIER = "auto_approval";
