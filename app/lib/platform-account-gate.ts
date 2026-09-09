import { supabaseAdmin } from "@/app/lib/supabase";

// Step 9: the join gate. A claimed or pending_verification account never
// satisfies this — only a verified row, currently within its validity window,
// counts. Having a verified account on one platform never authorizes an
// unverified account on another; this only asks "does this player have *a*
// currently active verified platform account," any one of them.
export async function hasActiveVerifiedPlatformAccount(playerId: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const { data } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id")
    .eq("player_id", playerId)
    .eq("verification_status", "verified")
    .lte("valid_from", nowIso)
    .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
    .limit(1);
  return !!(data && data.length);
}

export async function isJoinGateEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("league_settings").select("join_gate_enabled").single();
  return !!data?.join_gate_enabled;
}

// Temporary preview: forces the Settings nav badge and the claim-card outline on
// for everyone, so they can be reviewed from an account that already has a
// verified claim. Flip to false to ship. This is the only switch — both surfaces
// read the predicate below.
export const PREVIEW_FORCE_CLAIM_ALERT = true;

// Whether to point a player at the claim form in red. Only their own inaction
// counts: no claim at all, or one an admin turned down. A claim that is merely
// awaiting review is deliberately not an alert — they have done their part, and
// red on the card they just submitted reads as "your claim failed".
export async function needsPlatformAccountClaim(playerId: string, now: Date): Promise<boolean> {
  if (PREVIEW_FORCE_CLAIM_ALERT) return true;
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
