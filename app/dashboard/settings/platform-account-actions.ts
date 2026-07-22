"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isCurrentlyKicked } from "@/app/lib/players";
import { parseReplay, type ReplayPlatform } from "@/app/lib/replay-parser";

const CLAIMABLE_PLATFORMS = ["steam", "epic", "playstation", "xbox", "switch"] as const;
type ClaimablePlatform = typeof CLAIMABLE_PLATFORMS[number];

const ACTIVE_STATUSES = ["claimed", "pending_verification", "verified"];

const MAX_REPLAY_BYTES = 5 * 1024 * 1024;
const MAX_REPLAY_AGE_DAYS = 30;

export type ClaimReplayCandidate = {
  index: number;
  name: string;
  team: 0 | 1;
  platform: ReplayPlatform | null;
  claimable: boolean;
};

// Rocket League's embedded replay Date property is "YYYY-MM-DD:HH-mm-ss"
// (no timezone). We only need day-granularity recency, so treating it as
// local time is fine.
function parseReplayDate(raw: string | null): Date | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[:\s](\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isClaimablePlatform(value: string | null): value is ClaimablePlatform {
  return !!value && (CLAIMABLE_PLATFORMS as readonly string[]).includes(value);
}

// Candidate IDs come from the replay parser, not user input, but we still
// enforce the canonical shape each platform is expected to produce so a
// malformed/unexpected value can't slip into the uniqueness constraint in a
// form that would collide with (or fail to collide with) a manually-verified
// value stored elsewhere.
function normalizeCandidateId(platform: ClaimablePlatform, raw: string): string | null {
  const trimmed = raw.trim();
  if (platform === "steam") return /^\d{17}$/.test(trimmed) ? trimmed : null;
  if (platform === "epic") {
    const lower = trimmed.toLowerCase();
    return /^[0-9a-f]{32}$/.test(lower) ? lower : null;
  }
  return /^\d{1,20}$/.test(trimmed) ? trimmed : null; // playstation / xbox / switch
}

async function currentClaimant() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, kick_reason, kicked_until")
    .eq("discord_id", session.userId)
    .single();

  if (!player || player.status !== "approved" || isCurrentlyKicked(player.kick_reason, player.kicked_until)) {
    redirect("/dashboard");
  }

  return { userId: session.userId, playerId: player.id as string };
}

// Step 1 of the unified claim flow: upload a replay once, parse it, and hand
// the client back a name/team/platform picker so the player can point at
// their own row. We never send onlineId to the client — the submit step
// re-downloads and re-parses the stored file and derives the platform account
// ID server-side from the chosen index, so nothing the client sends is
// trusted as identity.
export async function previewClaimReplay(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean; replayPath?: string; candidates?: ClaimReplayCandidate[] }> {
  const { playerId } = await currentClaimant();

  const file = formData.get("verification_replay") as File | null;
  if (!file || file.size === 0) return { error: "Upload a .replay file from a match you played." };
  if (!file.name.toLowerCase().endsWith(".replay")) return { error: "File must be a .replay file." };
  if (file.size > MAX_REPLAY_BYTES) return { error: "Replay file must be 5 MB or smaller." };

  const bytes = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseReplay(bytes);
  } catch {
    return { error: "Couldn't read that replay file. Make sure it's an unmodified .replay from the match." };
  }
  if (parsed.players.length === 0) return { error: "No players were found in that replay." };

  const path = `${playerId}/claim-${Date.now()}.replay`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("platform-verification-replays")
    .upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
  if (uploadError) return { error: "Failed to upload replay. Please try again." };

  const candidates: ClaimReplayCandidate[] = parsed.players.map((p, index) => ({
    index,
    name: p.name,
    team: p.team,
    platform: p.platform,
    claimable: isClaimablePlatform(p.platform),
  }));

  return { ok: true, replayPath: path, candidates };
}

export async function claimPlatformAccount(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const { userId, playerId } = await currentClaimant();

  const trackerUrl = ((formData.get("tracker_url") as string) ?? "").trim();
  if (!trackerUrl) return { error: "Tracker URL is required." };
  try {
    new URL(trackerUrl);
  } catch {
    return { error: "Please enter a valid tracker URL." };
  }

  const replayPath = ((formData.get("replay_path") as string) ?? "").trim();
  const selectedIndex = Number.parseInt((formData.get("selected_index") as string) ?? "", 10);
  if (!replayPath || Number.isNaN(selectedIndex)) {
    return { error: "Upload a replay and select your row first." };
  }
  if (!replayPath.startsWith(`${playerId}/`)) {
    return { error: "That replay upload doesn't belong to you. Please upload it again." };
  }

  const { data: file, error: downloadError } = await supabaseAdmin.storage
    .from("platform-verification-replays")
    .download(replayPath);
  if (downloadError || !file) return { error: "Couldn't re-read your uploaded replay. Please upload it again." };
  const bytes = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseReplay(bytes);
  } catch {
    return { error: "Couldn't read that replay file. Please upload it again." };
  }

  const candidate = parsed.players[selectedIndex];
  if (!candidate) return { error: "That selection is no longer valid. Please upload and pick again." };
  if (!isClaimablePlatform(candidate.platform)) {
    return { error: "That row's platform can't be claimed automatically. Pick a different row or contact an admin." };
  }
  const platform = candidate.platform;

  // The header parser reliably extracts OnlineID for most platforms, but not
  // every replay version/platform combination emits one. Rather than lock
  // the player out, fall back to a null-ID claim an admin resolves manually
  // (per the original console verification workflow) — the active-claim
  // unique index already excludes null platform_account_id rows, so this
  // can't collide with anyone else's claim.
  const platformAccountId = candidate.onlineId ? normalizeCandidateId(platform, candidate.onlineId) : null;

  const claimedDisplayName = candidate.name;
  const claimNotes: string[] = [];
  if (!platformAccountId) {
    claimNotes.push("⚠ No platform ID in replay header — admin must extract it manually before verifying.");
  }

  const replayDate = parseReplayDate(parsed.date);
  if (replayDate) {
    const ageMs = Date.now() - replayDate.getTime();
    if (ageMs > MAX_REPLAY_AGE_DAYS * 24 * 60 * 60 * 1000) {
      return { error: `That replay is more than ${MAX_REPLAY_AGE_DAYS} days old. Upload a more recent replay of yourself.` };
    }
  } else {
    claimNotes.push("⚠ Replay date unreadable — admin must manually confirm recency.");
  }

  const { data: existing } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("id, verification_status")
    .eq("player_id", playerId)
    .eq("platform", platform)
    .in("verification_status", ACTIVE_STATUSES)
    .maybeSingle();

  if (existing?.verification_status === "verified") {
    return { error: "This platform is already verified. Contact an admin to change it." };
  }

  let banEvasionFlagged = false;
  if (platformAccountId) {
    const { data: ownedByOther } = await supabaseAdmin
      .from("player_platform_accounts")
      .select("id")
      .eq("platform", platform)
      .eq("platform_account_id", platformAccountId)
      .in("verification_status", ACTIVE_STATUSES)
      .neq("player_id", playerId)
      .maybeSingle();
    if (ownedByOther) return { error: "That account is already claimed by another player." };

    // Ban-evasion cross-check: look across ALL historical claims (not just the
    // active-status subset above) for this exact platform ID. If a different
    // player has ever held it and that player is now banned or kicked, this
    // looks like the same real account resurfacing under a new Discord
    // identity. We flag for admin review rather than hard-block — the
    // verification gate already stops it from becoming "verified" without a
    // human looking at it, and a hard block risks locking out a legitimate
    // account transfer.
    const { data: priorClaims } = await supabaseAdmin
      .from("player_platform_accounts")
      .select("player_id")
      .eq("platform", platform)
      .eq("platform_account_id", platformAccountId)
      .neq("player_id", playerId);

    const priorOwnerIds = [...new Set((priorClaims ?? []).map((c) => c.player_id as string))];
    if (priorOwnerIds.length > 0) {
      const { data: priorOwners } = await supabaseAdmin
        .from("players")
        .select("id, status, kick_reason, kicked_until")
        .in("id", priorOwnerIds);
      const flaggedOwner = (priorOwners ?? []).find(
        (o) => o.status === "banned" || isCurrentlyKicked(o.kick_reason, o.kicked_until)
      );
      if (flaggedOwner) {
        banEvasionFlagged = true;
        claimNotes.unshift(
          `⚠ BAN-EVASION: this ${platform} account (${platformAccountId}) was previously held by a player who is now ${flaggedOwner.status === "banned" ? "banned" : "kicked"}.`
        );
      }
    }
  }

  const row = {
    player_id: playerId,
    platform,
    platform_account_id: platformAccountId,
    claimed_display_name: claimedDisplayName,
    claimed_tracker_url: trackerUrl,
    claimed_verification_replay_path: replayPath,
    admin_note: claimNotes.length > 0 ? claimNotes.join(" | ") : null,
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
    actor: userId,
    detail_json: { platform, platform_account_id: platformAccountId },
  });

  if (banEvasionFlagged) {
    await supabaseAdmin.from("player_platform_account_events").insert({
      account_id: accountId,
      event_type: "ban_evasion_flagged",
      actor: userId,
      detail_json: { platform, platform_account_id: platformAccountId },
    });
  }

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
    .select("id, verification_status, claimed_verification_replay_path")
    .eq("id", accountId)
    .eq("player_id", player.id)
    .single();

  if (!account) return { error: "Claim not found." };
  if (!["claimed", "pending_verification"].includes(account.verification_status)) {
    return { error: "Only unverified claims can be withdrawn. Contact an admin to remove a verified account." };
  }

  const { error } = await supabaseAdmin
    .from("player_platform_accounts")
    .update({
      verification_status: "withdrawn",
      claimed_verification_replay_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  if (error) return { error: "Failed to withdraw claim." };

  if (account.claimed_verification_replay_path) {
    await supabaseAdmin.storage
      .from("platform-verification-replays")
      .remove([account.claimed_verification_replay_path]);
  }

  await supabaseAdmin.from("player_platform_account_events").insert({
    account_id: accountId,
    event_type: "withdrawn",
    actor: session.userId,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
