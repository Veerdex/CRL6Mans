"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

const CLAIMABLE_PLATFORMS = ["steam", "epic", "playstation", "xbox", "switch"] as const;
type ClaimablePlatform = typeof CLAIMABLE_PLATFORMS[number];

const ACTIVE_STATUSES = ["claimed", "pending_verification", "verified"];

const MAX_REPLAY_BYTES = 5 * 1024 * 1024;

function isClaimablePlatform(value: string): value is ClaimablePlatform {
  return (CLAIMABLE_PLATFORMS as readonly string[]).includes(value);
}

// Accepts a raw 17-digit SteamID64 or a steamcommunity.com/profiles/<id> URL.
// Vanity URLs (steamcommunity.com/id/name) can't be resolved to a SteamID64
// without a Steam Web API key this project doesn't have, so they're rejected
// with guidance rather than silently accepted and left unusable.
function normalizeSteamId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{17}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  return match ? match[1] : null;
}

function normalizeEpicId(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(trimmed) ? trimmed : null;
}

export async function claimPlatformAccount(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const platformRaw = ((formData.get("platform") as string) ?? "").trim().toLowerCase();
  if (!isClaimablePlatform(platformRaw)) return { error: "Unknown platform." };
  const platform = platformRaw;

  const trackerUrl = ((formData.get("tracker_url") as string) ?? "").trim();
  if (!trackerUrl) return { error: "Tracker URL is required." };
  try {
    new URL(trackerUrl);
  } catch {
    return { error: "Please enter a valid tracker URL." };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, kick_reason")
    .eq("discord_id", session.userId)
    .single();

  if (!player || player.status !== "approved" || player.kick_reason) redirect("/dashboard");

  let platformAccountId: string | null = null;
  let claimedDisplayName: string | null = null;
  let replayPath: string | null = null;

  if (platform === "steam") {
    platformAccountId = normalizeSteamId((formData.get("steam_id") as string) ?? "");
    if (!platformAccountId) {
      return { error: "Enter your 17-digit SteamID64 or a steamcommunity.com/profiles/... URL." };
    }
    claimedDisplayName = ((formData.get("display_name") as string) ?? "").trim() || null;
  } else if (platform === "epic") {
    platformAccountId = normalizeEpicId((formData.get("epic_account_id") as string) ?? "");
    if (!platformAccountId) {
      return { error: "Enter your 32-character Epic Account ID from epicgames.com/account." };
    }
    claimedDisplayName = ((formData.get("display_name") as string) ?? "").trim() || null;
  } else {
    // playstation / xbox / switch — never ask for a numeric console ID here;
    // the console verification-replay workflow (admin-run, offline) populates
    // platform_account_id later. platformAccountId stays null.
    claimedDisplayName = ((formData.get("display_name") as string) ?? "").trim();
    if (!claimedDisplayName) return { error: "Enter your platform display name." };

    const file = formData.get("verification_replay") as File | null;
    if (file && file.size > 0) {
      if (!file.name.toLowerCase().endsWith(".replay")) {
        return { error: "Verification file must be a .replay file." };
      }
      if (file.size > MAX_REPLAY_BYTES) {
        return { error: "Replay file must be 5 MB or smaller." };
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const path = `${player.id}/${platform}-${Date.now()}.replay`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("platform-verification-replays")
        .upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
      if (uploadError) return { error: "Failed to upload verification replay. Please try again." };
      replayPath = path;
    }
  }

  const { data: existing } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, verification_status")
    .eq("player_id", player.id)
    .eq("platform", platform)
    .in("verification_status", ACTIVE_STATUSES)
    .maybeSingle();

  if (existing?.verification_status === "verified") {
    return { error: "This platform is already verified. Contact an admin to change it." };
  }

  if (platformAccountId) {
    const { data: ownedByOther } = await supabaseAdmin
      .from("player_platform_accounts")
      .select("id")
      .eq("platform", platform)
      .eq("platform_account_id", platformAccountId)
      .in("verification_status", ACTIVE_STATUSES)
      .neq("player_id", player.id)
      .maybeSingle();
    if (ownedByOther) return { error: "That account is already claimed by another player." };
  }

  const row = {
    player_id: player.id,
    platform,
    platform_account_id: platformAccountId,
    claimed_display_name: claimedDisplayName,
    claimed_tracker_url: trackerUrl,
    claimed_verification_replay_path: replayPath,
    verification_status: "claimed",
    updated_at: new Date().toISOString(),
  };

  let accountId: string;
  if (existing) {
    const { error } = await supabaseAdmin
      .from("player_platform_accounts")
      .update(row)
      .eq("id", existing.id);
    if (error) {
      if (error.code === "23505") return { error: "That account is already claimed by another player." };
      return { error: "Failed to update claim. Please try again." };
    }
    accountId = existing.id;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("player_platform_accounts")
      .insert(row)
      .select("id")
      .single();
    if (error || !inserted) {
      if (error?.code === "23505") return { error: "That account is already claimed by another player." };
      return { error: "Failed to submit claim. Please try again." };
    }
    accountId = inserted.id;
  }

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "claimed",
    actor: session.userId,
    detail_json: { platform, platform_account_id: platformAccountId },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function withdrawPlatformAccount(
  accountId: string
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("discord_id", session.userId)
    .single();
  if (!player) return { error: "Player not found." };

  const { data: account } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, verification_status")
    .eq("id", accountId)
    .eq("player_id", player.id)
    .single();

  if (!account) return { error: "Claim not found." };
  if (!["claimed", "pending_verification"].includes(account.verification_status)) {
    return { error: "Only unverified claims can be withdrawn. Contact an admin to remove a verified account." };
  }

  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({ verification_status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", accountId);

  if (error) return { error: "Failed to withdraw claim." };

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "withdrawn",
    actor: session.userId,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
