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
