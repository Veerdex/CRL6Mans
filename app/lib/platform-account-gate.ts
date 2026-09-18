import { supabaseAdmin } from "@/app/lib/supabase";

// Step 9: the join gate. A claimed or pending_verification account never
// satisfies this — only a verified row, currently within its validity window,
// counts. Having a verified account on one platform never authorizes an
// unverified account on another; this only asks "does this player have *a*
// currently active verified platform account," any one of them.
//
// Unless admin approval has been switched off, in which case an unreviewed
// claim counts too — see isClaimApprovalRequired. The validity window is still
// applied to whatever is accepted; the toggle relaxes which statuses qualify,
// never whether the row is currently in force.
export async function hasActiveVerifiedPlatformAccount(playerId: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const query = supabaseAdmin
    .from("player_platform_accounts")
    .select("id")
    .eq("player_id", playerId)
    .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
    .limit(1);

  if (await isClaimApprovalRequired()) {
    const { data } = await query.eq("verification_status", "verified").lte("valid_from", nowIso);
    return !!(data && data.length);
  }

  // A claimed row has no valid_from — it is in force from the moment it was
  // submitted, so created_at is the window start, not valid_from.
  const { data } = await query
    .in("verification_status", ["verified", "claimed", "pending_verification"])
    .lte("created_at", nowIso);
  return !!(data && data.length);
}

export async function isJoinGateEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("league_settings").select("join_gate_enabled").single();
  return !!data?.join_gate_enabled;
}

// Whether a platform-account claim has to be reviewed by an admin before it
// counts for anything. ON is what shipped originally and stays the default:
// the `?? true` is what makes a missing column or a null read as ON, so the
// window between deploying this and running the migration cannot quietly
// accept unreviewed claims. Only an explicit `false` in the DB loosens it.
export async function isClaimApprovalRequired(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("claim_approval_required")
    .single();
  return (data as { claim_approval_required?: boolean | null } | null)?.claim_approval_required ?? true;
}

// A verified account exists to resolve a replay's players back to rows — that is
// its only reader. An event not tracking stats takes no replays at all (the
// score-only flow in series-replay-panel), so the account it would demand is
// never looked at, and the gate is friction with nothing behind it.
//
// statsEnabled belongs to the event being joined, not to league_settings, which
// mirrors whichever event is live — a player signing up for next month's
// tournament would otherwise be judged against this month's.
export async function joinGateApplies(statsEnabled: boolean): Promise<boolean> {
  if (!statsEnabled) return false;
  return isJoinGateEnabled();
}

// Whether to point a player at the claim form in red. Only their own inaction
// counts: no claim at all, or one an admin turned down. A claim that is merely
// awaiting review is deliberately not an alert — they have done their part, and
// red on the card they just submitted reads as "your claim failed".
export async function needsPlatformAccountClaim(playerId: string, now: Date): Promise<boolean> {
  if (!(await isJoinGateEnabled())) return false;
  if (await hasActiveVerifiedPlatformAccount(playerId, now)) return false;

  const { data } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id")
    .eq("player_id", playerId)
    .in("verification_status", ["claimed", "pending_verification"])
    .limit(1);
  return !(data && data.length);
}
