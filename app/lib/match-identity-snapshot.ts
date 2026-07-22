import { supabaseAdmin } from "@/app/lib/supabase";

type MatchIdentityRoster = {
  home: { team_id: string; player_ids: string[] };
  away: { team_id: string; player_ids: string[] };
  approved_subs: Array<{ team_id: string; player_out_id: string; sub_player_ids: string[] }>;
};

async function fetchApprovedSubs(matchId: string) {
  const { data } = await supabaseAdmin
    .from("sub_requests")
    .select("team_id, player_out_id, sub_player_id, sub_player_ids")
    .eq("match_id", matchId)
    .eq("status", "approved");
  return (data ?? []).map(s => ({
    team_id: s.team_id as string,
    player_out_id: s.player_out_id as string,
    sub_player_ids: (s.sub_player_ids as string[] | null) ?? (s.sub_player_id ? [s.sub_player_id as string] : []),
  }));
}

// Freezes the roster/eligibility picture for a match the first time a replay
// is processed for it, and keeps the approved-subs portion synced on every
// later call for the same match. Account verification status is deliberately
// NOT frozen here — it's never hard-deleted and carries verified_at/
// revoked_at/valid_from, so "verified and active as of kickoff_at" is
// something the Step 6 resolver can compute on demand against kickoff_at
// instead.
//
// kickoff_at, home_team_id/away_team_id, and the base roster are frozen at
// creation and never rewritten — they protect against a team retroactively
// claiming a non-sub roster change after the fact. approved_subs is the one
// field re-synced on every call: subs go through their own admin-approved,
// timestamped workflow (sub_requests) and the rulebook explicitly allows a
// sub to be swapped in between games of a series, so a sub approved after
// game 1's snapshot was created must still show up for game 2+ or the
// resolver will wrongly flag them as an unexpected account.
//
// kickoff_at is matches.scheduled_at when set, else the time of the first
// call. The replay's own embedded Date header is never used: it reflects the
// uploader's local system clock (no recorded timezone) and is attacker-
// controllable, so it can't anchor a security-relevant cutoff.
//
// No exact-lineup submission UI exists in this codebase, so every snapshot
// uses lineup_mode 'eligible_roster' — the analyzer certifies eligible
// roster members played, not a predeclared six-player lineup.
export async function ensureMatchIdentitySnapshot(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabaseAdmin
    .from("match_identity_snapshots")
    .select("id, roster_json")
    .eq("match_id", matchId)
    .maybeSingle();

  if (existing) {
    const approvedSubs = await fetchApprovedSubs(matchId);
    const rosterJson = { ...(existing.roster_json as MatchIdentityRoster), approved_subs: approvedSubs };
    const { error } = await supabaseAdmin
      .from("match_identity_snapshots")
      .update({ roster_json: rosterJson })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, scheduled_at")
    .eq("id", matchId)
    .single();
  if (!match?.home_team_id || !match?.away_team_id) {
    return { ok: false, error: "Match is missing team assignments" };
  }

  const [{ data: roster }, approvedSubs] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("id, team_id")
      .in("team_id", [match.home_team_id, match.away_team_id])
      .eq("status", "approved"),
    fetchApprovedSubs(matchId),
  ]);

  const rosterJson: MatchIdentityRoster = {
    home: {
      team_id: match.home_team_id,
      player_ids: (roster ?? []).filter(p => p.team_id === match.home_team_id).map(p => p.id),
    },
    away: {
      team_id: match.away_team_id,
      player_ids: (roster ?? []).filter(p => p.team_id === match.away_team_id).map(p => p.id),
    },
    approved_subs: approvedSubs,
  };

  const { error } = await supabaseAdmin.from("match_identity_snapshots").insert({
    match_id: matchId,
    lineup_mode: "eligible_roster",
    kickoff_at: match.scheduled_at ?? new Date().toISOString(),
    home_team_id: match.home_team_id,
    away_team_id: match.away_team_id,
    roster_json: rosterJson,
  });

  // 23505 means a concurrent call already created the snapshot — not an error.
  if (error && error.code !== "23505") return { ok: false, error: error.message };
  return { ok: true };
}
