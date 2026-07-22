import { supabaseAdmin } from "@/app/lib/supabase";
import type { PlayerStat } from "@/app/lib/replay-parser";
import type { ExpectedPlayer, VerifiedAccountRecord } from "@/app/lib/replay-identity-resolver";

type MatchIdentityRoster = {
  home: { team_id: string; player_ids: string[] };
  away: { team_id: string; player_ids: string[] };
  approved_subs: Array<{ team_id: string; player_out_id: string; sub_player_ids: string[] }>;
};

export type ResolverContext = {
  expectedLineup: ExpectedPlayer[];
  currentlyEligiblePlayerIds: Set<string>;
  kickoffAt: string;
  globalVerifiedAccounts: VerifiedAccountRecord[];
};

// Assembles everything resolveReplayParticipants needs for one match/replay,
// from the frozen snapshot (Step 5) plus a live eligibility + verified-account
// lookup. Returns null when no snapshot exists yet (e.g. ensureMatchIdentitySnapshot
// failed) — callers should treat that as "resolver can't run", not an error.
export async function buildResolverContext(
  matchId: string,
  replayPlayers: PlayerStat[],
): Promise<ResolverContext | null> {
  const { data: snapshot } = await supabaseAdmin
    .from("match_identity_snapshots")
    .select("kickoff_at, home_team_id, away_team_id, roster_json")
    .eq("match_id", matchId)
    .maybeSingle();
  if (!snapshot) return null;

  const roster = snapshot.roster_json as MatchIdentityRoster;
  const teamForTeamId = (teamId: string): ExpectedPlayer["team"] | null => {
    if (teamId === snapshot.home_team_id) return "home";
    if (teamId === snapshot.away_team_id) return "away";
    return null;
  };

  const expectedLineup: ExpectedPlayer[] = [
    ...roster.home.player_ids.map(playerId => ({ playerId, team: "home" as const })),
    ...roster.away.player_ids.map(playerId => ({ playerId, team: "away" as const })),
  ];
  for (const sub of roster.approved_subs) {
    const team = teamForTeamId(sub.team_id);
    if (!team) continue;
    for (const subInId of sub.sub_player_ids) {
      if (!expectedLineup.some(e => e.playerId === subInId)) expectedLineup.push({ playerId: subInId, team });
    }
  }

  const expectedIds = expectedLineup.map(e => e.playerId);
  const { data: livePlayers } = expectedIds.length > 0
    ? await supabaseAdmin.from("players").select("id, status").in("id", expectedIds)
    : { data: [] as Array<{ id: string; status: string }> };
  const currentlyEligiblePlayerIds = new Set(
    (livePlayers ?? []).filter(p => p.status === "approved").map(p => p.id),
  );

  const globalVerifiedAccounts = await fetchGlobalVerifiedAccounts(replayPlayers);

  return {
    expectedLineup,
    currentlyEligiblePlayerIds,
    kickoffAt: snapshot.kickoff_at as string,
    globalVerifiedAccounts,
  };
}

// For entry points with no matchId (the standalone test-replay tool): there's no
// snapshot or expected lineup to resolve against, only global account ownership.
export async function fetchGlobalVerifiedAccounts(
  replayPlayers: PlayerStat[],
): Promise<VerifiedAccountRecord[]> {
  const distinctOnlineIds = Array.from(
    new Set(replayPlayers.map(p => p.onlineId).filter((v): v is string => !!v)),
  );
  if (distinctOnlineIds.length === 0) return [];

  const { data: accounts } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("player_id, platform, platform_account_id, verified_display_name, valid_from, valid_until, revoked_at")
    .in("platform_account_id", distinctOnlineIds)
    .not("verified_at", "is", null);

  return (accounts ?? []).map(a => ({
    playerId: a.player_id as string,
    platform: a.platform as VerifiedAccountRecord["platform"],
    platformAccountId: a.platform_account_id as string,
    verifiedDisplayName: a.verified_display_name as string | null,
    validFrom: a.valid_from as string,
    validUntil: a.valid_until as string | null,
    revokedAt: a.revoked_at as string | null,
  }));
}
