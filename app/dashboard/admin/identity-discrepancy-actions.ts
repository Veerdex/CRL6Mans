"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified, isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { buildResolverContext } from "@/app/lib/replay-identity-context";
import { resolveReplayParticipants } from "@/app/lib/replay-identity-resolver";
import type { PlayerStat } from "@/app/lib/replay-parser";

const RESOLUTION_TYPES = [
  "registration_corrected",
  "early_approval_recognized",
  "lineup_corrected",
  "sub_approved",
  "rejected",
  "escalated",
] as const;
export type DiscrepancyResolution = typeof RESOLUTION_TYPES[number];

function isResolutionType(value: string): value is DiscrepancyResolution {
  return (RESOLUTION_TYPES as readonly string[]).includes(value);
}

async function requireAdmin(): Promise<string> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
  return session.userId;
}

// League-wide gate, so require Director+ — same bar as the other serious
// league toggles in league-actions.ts.
export async function setIdentityEnforcementEnabled(value: boolean): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ identity_enforcement_enabled: value })
    .not("id", "is", null);
  if (error) return { error: "Failed to update." };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Step 9 join gate, Director+ same as the enforcement toggle above — this
// blocks new entrants league-wide the instant it's on, so it's as serious a
// lever as identity_enforcement_enabled.
export async function setJoinGateEnabled(value: boolean): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({ join_gate_enabled: value })
    .not("id", "is", null);
  if (error) return { error: "Failed to update." };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Records the admin's adjudication of a discrepancy. This never certifies a
// match directly — only re-analyzing the replay through the existing upload/
// analyze flow (which reruns the Step 6 resolver) can flip identity_status to
// "certified". Corrective resolutions here just document the decision and
// reason; the admin still has to go fix the underlying data (platform
// account, lineup snapshot, sub approval) and re-upload the replay.
export async function resolveIdentityDiscrepancy(
  discrepancyId: string,
  resolution: string,
  adminReason: string,
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireAdmin();

  if (!isResolutionType(resolution)) return { error: "Unknown resolution type." };
  if (!adminReason.trim()) return { error: "A reason is required." };

  const { data: row } = await supabaseAdmin
    .from("replay_identity_discrepancies")
    .select("id, status, match_id")
    .eq("id", discrepancyId)
    .single();
  if (!row) return { error: "Discrepancy not found." };
  if (row.status !== "open") return { error: "This discrepancy has already been resolved." };

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("replay_identity_discrepancies")
    .update({
      status: "resolved",
      resolution,
      admin_reason: adminReason.trim(),
      resolved_by: adminId,
      resolved_at: now,
    })
    .eq("id", discrepancyId);
  if (error) return { error: "Failed to save resolution." };

  // "Rejected" writes a cosmetic identity_status label for visibility, but it
  // is not terminal: if the match is later resubmitted (e.g. after a
  // correction) resolveSubmittedGames recomputes identity_status from scratch
  // and can overwrite this back to "certified". It does not forfeit the match
  // or block further submission — use the DQ/forfeit tool for that.
  if (resolution === "rejected") {
    await supabaseAdmin.from("matches").update({ identity_status: "rejected" }).eq("id", row.match_id);
  }

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Re-runs the Step 6 resolver server-side using the per-player identity
// fields captured at analyze time (name/team/platform/onlineId/identitySource
// — everything resolveReplayParticipants needs, none of the raw replay
// bytes), instead of requiring a fresh .replay upload. Only meaningful after
// an admin has actually fixed the underlying cause (e.g. verified the
// player's platform account) — buildResolverContext re-fetches live account/
// eligibility state, so a genuine fix here changes the outcome exactly as a
// re-upload would have.
//
// This still never manually forces a match certified: it's a real resolver
// re-run, just fed from stored inputs. On success it clears
// player_resolutions_json (nothing left to reverify) and auto-resolves the
// open discrepancy rows for this replay; on failure it leaves both alone so
// the admin can fix further and try again.
export async function reverifyGameIdentity(
  matchId: string,
  gameNumber: number,
): Promise<{ error?: string; ok?: boolean; certified?: boolean; message?: string }> {
  const adminId = await requireAdmin();

  const { data: certRow } = await supabaseAdmin
    .from("replay_identity_certifications")
    .select("replay_id, player_resolutions_json")
    .eq("match_id", matchId)
    .eq("game_number", gameNumber)
    .maybeSingle();
  if (!certRow?.replay_id) return { error: "No analyzed replay found for this game." };
  if (!certRow.player_resolutions_json) {
    return { error: "No stored identity data for this replay — re-upload it to analyze again." };
  }

  const storedIdentities = certRow.player_resolutions_json as Array<
    Pick<PlayerStat, "name" | "team" | "platform" | "onlineId" | "identityKey" | "identitySource">
  >;
  const activePlayers: PlayerStat[] = storedIdentities.map(p => ({
    ...p,
    score: 1,
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
  }));

  const context = await buildResolverContext(matchId, activePlayers);
  if (!context) return { error: "Could not rebuild match context for this game." };

  const resolution = resolveReplayParticipants({
    replayPlayers: activePlayers,
    expectedLineup: context.expectedLineup,
    currentlyEligiblePlayerIds: context.currentlyEligiblePlayerIds,
    kickoffAt: context.kickoffAt,
    globalVerifiedAccounts: context.globalVerifiedAccounts,
  });

  const certified = resolution.players.every(p => p.type === "matched-by-platform-id");
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("replay_identity_certifications")
    .update({
      certified,
      reason: certified
        ? "All active players resolved by verified platform ID (reverified)"
        : "One or more players still fail identity verification",
      player_resolutions_json: certified ? null : certRow.player_resolutions_json,
      evaluated_at: now,
    })
    .eq("replay_id", certRow.replay_id);

  if (certified) {
    await supabaseAdmin
      .from("replay_identity_discrepancies")
      .update({
        status: "resolved",
        resolution: "reverified",
        admin_reason: "Automatically reverified after admin correction — all players now resolve by verified platform ID.",
        resolved_by: adminId,
        resolved_at: now,
      })
      .eq("replay_id", certRow.replay_id)
      .eq("status", "open");
  }

  revalidatePath("/dashboard/admin");
  return {
    ok: true,
    certified,
    message: certified
      ? "Reverified — all players now resolve correctly."
      : "Still failing — one or more players still don't resolve to a verified platform ID.",
  };
}
