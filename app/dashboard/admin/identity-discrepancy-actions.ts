"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModerator, isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

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
  if (!session?.userId || !(await isModerator(session.userId))) redirect("/dashboard");
  return session.userId;
}

// League-wide gate, so require Director+ — same bar as the other serious
// league toggles in league-actions.ts.
export async function setIdentityEnforcementEnabled(value: boolean): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirector(session.userId))) redirect("/dashboard");

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
  if (!session?.userId || !(await isDirector(session.userId))) redirect("/dashboard");

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
