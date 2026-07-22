"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { kickForRejectionCooldown, type RejectionCooldown } from "./player-moderation-actions";

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

async function requireAdmin(): Promise<string> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModerator(session.userId))) redirect("/dashboard");
  return session.userId;
}

export async function verifyPlatformAccount(
  accountId: string,
  input: {
    platformAccountId: string;
    verifiedDisplayName: string;
    adminNote: string;
  }
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireAdmin();

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, platform, platform_account_id, claimed_verification_replay_path, verification_status")
    .eq("id", accountId)
    .single();

  if (!account) return { error: "Claim not found." };
  if (!["claimed", "pending_verification"].includes(account.verification_status)) {
    return { error: "Only claimed or pending claims can be verified." };
  }

  const platformAccountId = input.platformAccountId.trim() || account.platform_account_id;
  if (!platformAccountId) {
    return { error: "Enter the platform account ID before verifying." };
  }

  let replaySha256: string | null = null;
  if (account.claimed_verification_replay_path) {
    const { data: file, error: downloadError } = await supabaseAdmin.storage
      .from("platform-verification-replays")
      .download(account.claimed_verification_replay_path);
    if (downloadError || !file) return { error: "Failed to read verification replay for hashing." };
    const bytes = Buffer.from(await file.arrayBuffer());
    replaySha256 = createHash("sha256").update(bytes).digest("hex");
  }

  const verificationMethod = DEFAULT_METHOD_BY_PLATFORM[account.platform] ?? "legacy_manual";
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({
      platform_account_id: platformAccountId,
      verification_status: "verified",
      verification_method: verificationMethod,
      verification_replay_sha256: replaySha256,
      claimed_verification_replay_path: null,
      verified_display_name: input.verifiedDisplayName.trim() || null,
      verified_by: adminId,
      verified_at: now,
      valid_from: now,
      admin_note: input.adminNote.trim() || null,
      updated_at: now,
    })
    .eq("id", accountId);

  if (error) {
    if (error.code === "23505") return { error: "That platform account ID is already claimed by another player." };
    return { error: "Failed to verify claim." };
  }

  // The SHA-256 recorded above is the permanent proof of what was verified;
  // the raw replay serves no further purpose once an account is verified,
  // so free the storage instead of retaining it indefinitely.
  if (account.claimed_verification_replay_path) {
    await supabaseAdmin.storage
      .from("platform-verification-replays")
      .remove([account.claimed_verification_replay_path]);
  }

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "verified",
    actor: adminId,
    detail_json: { platform: account.platform, platform_account_id: platformAccountId, method: verificationMethod },
  });

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function rejectPlatformAccount(
  accountId: string,
  adminNote: string,
  cooldown?: RejectionCooldown
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireAdmin();

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, player_id, verification_status, claimed_verification_replay_path")
    .eq("id", accountId)
    .single();
  if (!account) return { error: "Claim not found." };
  if (!["claimed", "pending_verification"].includes(account.verification_status)) {
    return { error: "Only claimed or pending claims can be rejected." };
  }

  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({
      verification_status: "rejected",
      admin_note: adminNote.trim() || null,
      claimed_verification_replay_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return { error: "Failed to reject claim." };

  if (account.claimed_verification_replay_path) {
    await supabaseAdmin.storage
      .from("platform-verification-replays")
      .remove([account.claimed_verification_replay_path]);
  }

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "rejected",
    actor: adminId,
    detail_json: { admin_note: adminNote.trim() || null, cooldown: cooldown ?? null },
  });

  if (cooldown) {
    const cooldownResult = await kickForRejectionCooldown(
      account.player_id,
      adminNote.trim() || "Platform account claim rejected.",
      cooldown
    );
    if (cooldownResult.error) return { error: `Claim rejected, but the cooldown kick failed: ${cooldownResult.error}` };
  }

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Step 8 follow-up: corrects a verified account in place instead of the
// destructive revoke -> re-claim -> re-verify dance, which can't actually fix
// a past match anyway (re-verifying always stamps valid_from = now, so a
// corrected account still fails late-account-registration against a kickoff
// that's already passed). Only edits the fields the resolver reads; never
// touches verification_status/verified_by/verified_at, which stay as the
// record of the original verification.
export async function correctPlatformAccount(
  accountId: string,
  input: {
    platformAccountId: string;
    verifiedDisplayName: string;
    validFrom: string;
    adminReason: string;
  }
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireAdmin();

  if (!input.adminReason.trim()) return { error: "A reason is required to correct a verified account." };

  const platformAccountId = input.platformAccountId.trim();
  if (!platformAccountId) return { error: "Platform account ID cannot be empty." };

  const validFromDate = new Date(input.validFrom);
  if (Number.isNaN(validFromDate.getTime())) return { error: "Enter a valid date/time for valid-from." };
  if (validFromDate.getTime() > Date.now()) return { error: "Valid-from cannot be in the future." };

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, platform, platform_account_id, verified_display_name, valid_from, verification_status")
    .eq("id", accountId)
    .single();
  if (!account) return { error: "Account not found." };
  if (account.verification_status !== "verified") return { error: "Only verified accounts can be corrected." };

  const now = new Date().toISOString();
  const verifiedDisplayName = input.verifiedDisplayName.trim() || null;
  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({
      platform_account_id: platformAccountId,
      verified_display_name: verifiedDisplayName,
      valid_from: validFromDate.toISOString(),
      admin_note: input.adminReason.trim(),
      updated_at: now,
    })
    .eq("id", accountId);

  if (error) {
    if (error.code === "23505") return { error: "That platform account ID is already claimed by another player." };
    return { error: "Failed to correct account." };
  }

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "corrected",
    actor: adminId,
    detail_json: {
      admin_reason: input.adminReason.trim(),
      before: { platform_account_id: account.platform_account_id, verified_display_name: account.verified_display_name, valid_from: account.valid_from },
      after: { platform_account_id: platformAccountId, verified_display_name: verifiedDisplayName, valid_from: validFromDate.toISOString() },
    },
  });

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function revokePlatformAccount(
  accountId: string,
  adminNote: string
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireAdmin();
  if (!adminNote.trim()) return { error: "A reason is required to revoke a verified account." };

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, verification_status")
    .eq("id", accountId)
    .single();
  if (!account) return { error: "Account not found." };
  if (account.verification_status !== "verified") return { error: "Only verified accounts can be revoked." };

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({ verification_status: "revoked", revoked_by: adminId, revoked_at: now, admin_note: adminNote.trim(), updated_at: now })
    .eq("id", accountId);
  if (error) return { error: "Failed to revoke account." };

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "revoked",
    actor: adminId,
    detail_json: { admin_note: adminNote.trim() },
  });

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Lets an admin fix a mis-recorded ID directly from the Players panel, for any
// claim status — not just verified ones (see correctPlatformAccount above,
// which only handles the already-verified case).
export async function adminUpdatePlatformAccountId(
  accountId: string,
  newPlatformAccountId: string,
  adminReason: string
): Promise<{ error?: string; ok?: boolean }> {
  const adminId = await requireAdmin();

  const platformAccountId = newPlatformAccountId.trim();
  if (!platformAccountId) return { error: "Platform account ID cannot be empty." };

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, platform_account_id, verification_status")
    .eq("id", accountId)
    .single();
  if (!account) return { error: "Account not found." };
  if (account.verification_status === "verified" && !adminReason.trim()) {
    return { error: "A reason is required to edit a verified account." };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({
      platform_account_id: platformAccountId,
      admin_note: adminReason.trim() || null,
      updated_at: now,
    })
    .eq("id", accountId);

  if (error) {
    if (error.code === "23505") return { error: "That platform account ID is already claimed by another player." };
    return { error: "Failed to update account ID." };
  }

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "corrected",
    actor: adminId,
    detail_json: {
      admin_reason: adminReason.trim() || null,
      before: { platform_account_id: account.platform_account_id },
      after: { platform_account_id: platformAccountId },
    },
  });

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// Lets an admin remove a platform-account row directly from the Players panel.
// Any account that was ever verified (current status "verified", or "revoked"
// after having been verified) is never hard-deleted — it's soft-revoked instead,
// per the "verified accounts are never hard-deleted" rule, since past matches
// may have relied on it for identity certification. Everything else (claimed,
// pending_verification, rejected, withdrawn) has no certification history to
// preserve and is deleted outright, freeing the ID for legitimate re-claim.
export async function adminDeletePlatformAccount(
  accountId: string,
  adminReason: string
): Promise<{ error?: string; ok?: boolean; revoked?: boolean }> {
  const adminId = await requireAdmin();

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, verification_status, verified_at, claimed_verification_replay_path")
    .eq("id", accountId)
    .single();
  if (!account) return { error: "Account not found." };

  const hasVerificationHistory = account.verification_status === "verified" || !!account.verified_at;
  if (hasVerificationHistory) {
    if (!adminReason.trim()) return { error: "A reason is required to remove a verified account." };
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("player_platform_accounts")
      .update({ verification_status: "revoked", revoked_by: adminId, revoked_at: now, admin_note: adminReason.trim(), updated_at: now })
      .eq("id", accountId);
    if (error) return { error: "Failed to revoke account." };

    await supabaseAdmin.from("player_platform_account_events").insert({
      account_id: accountId,
      event_type: "revoked",
      actor: adminId,
      detail_json: { admin_note: adminReason.trim() },
    });

    revalidatePath("/dashboard/admin");
    return { ok: true, revoked: true };
  }

  if (account.claimed_verification_replay_path) {
    await supabaseAdmin.storage
      .from("platform-verification-replays")
      .remove([account.claimed_verification_replay_path]);
  }

  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .delete()
    .eq("id", accountId);
  if (error) return { error: "Failed to delete account." };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}
