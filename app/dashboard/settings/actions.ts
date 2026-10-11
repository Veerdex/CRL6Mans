"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { pushToAdmins } from "@/app/lib/push";
import { isCurrentlyKicked } from "@/app/lib/players";
import { applyPlayerRVChangeToTeamRating } from "@/app/lib/discord-bot";

function validateMmr(label: string, val: string): string | null {
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) return `${label} must be a non-negative whole number.`;
  if (n > 3000) return `${label} cannot exceed 3000.`;
  return null;
}

/** Season Peak is `current_*`, All Time Peak is `peak_*` — the labels the forms show. */
type MmrInput = {
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
};

const MMR_PLAYER_COLUMNS =
  "id, team_id, peak_3v3, current_3v3, peak_2v2, current_2v2, peak_1v1, current_1v1";

/** MMR columns come back from supabase-js as strings — the shape RatingFields wants. */
type MmrPlayerRow = {
  id: string;
  team_id: string | null;
  peak_3v3: string; current_3v3: string;
  peak_2v2: string; current_2v2: string;
  peak_1v1: string | null; current_1v1: string | null;
};

function validateMmrInput(v: MmrInput): string | null {
  for (const [label, val] of [
    ["All Time Peak 3v3", v.peak_3v3],
    ["Season Peak 3v3", v.current_3v3],
    ["All Time Peak 2v2", v.peak_2v2],
    ["Season Peak 2v2", v.current_2v2],
  ] as [string, string][]) {
    if (!val?.trim()) return `${label} is required.`;
    const err = validateMmr(label, val.trim());
    if (err) return err;
  }
  if (Number(v.current_3v3) > Number(v.peak_3v3))
    return "Season Peak 3v3 cannot exceed All Time Peak 3v3.";
  if (Number(v.current_2v2) > Number(v.peak_2v2))
    return "Season Peak 2v2 cannot exceed All Time Peak 2v2.";
  return null;
}

/**
 * The one writer of a player's own MMR. Deliberately not exported: every export
 * of a "use server" module is a public endpoint, and this takes the row to write
 * as an argument, so an exported version would let anyone rewrite anyone's MMR.
 * Callers resolve the row from the session first.
 *
 * Writes both tiers — `loadPlayerProfile` reads `pending_players` ahead of
 * `players`, so a Tier 3 only write succeeds and changes nothing a player sees.
 */
async function applyMmrChange(
  player: MmrPlayerRow,
  next: MmrInput,
  now: string,
): Promise<{ changed: boolean; error?: string }> {
  const changed =
    Number(next.peak_3v3) !== Number(player.peak_3v3) ||
    Number(next.current_3v3) !== Number(player.current_3v3) ||
    Number(next.peak_2v2) !== Number(player.peak_2v2) ||
    Number(next.current_2v2) !== Number(player.current_2v2);

  if (!changed) return { changed: false };

  await supabaseAdmin
    .from("pending_players")
    .update({
      peak_3v3:    next.peak_3v3,
      current_3v3: next.current_3v3,
      peak_2v2:    next.peak_2v2,
      current_2v2: next.current_2v2,
      updated_at:  now,
    })
    .eq("account_id", player.id);

  const { error } = await supabaseAdmin
    .from("players")
    .update({
      peak_3v3:    next.peak_3v3,
      current_3v3: next.current_3v3,
      peak_2v2:    next.peak_2v2,
      current_2v2: next.current_2v2,
      updated_at:  now,
    })
    .eq("id", player.id);

  if (error) return { changed: false, error: "Failed to save MMR. Please try again." };

  if (player.team_id) {
    await applyPlayerRVChangeToTeamRating(
      player.id,
      player.team_id,
      {
        peak_2v2:    player.peak_2v2,
        current_2v2: player.current_2v2,
        peak_3v3:    player.peak_3v3,
        current_3v3: player.current_3v3,
        peak_1v1:    player.peak_1v1,
        current_1v1: player.current_1v1,
      },
      {
        peak_2v2:    next.peak_2v2,
        current_2v2: next.current_2v2,
        peak_3v3:    next.peak_3v3,
        current_3v3: next.current_3v3,
        peak_1v1:    player.peak_1v1,
        current_1v1: player.current_1v1,
      },
    ).catch(() => {});
  }

  return { changed: true };
}

/**
 * Same self-service MMR edit as the Settings form, reached from the MMR card on
 * a player's own profile popup. Refuses by returning an error rather than
 * redirecting, since the caller is a popup over whatever page the viewer is on.
 */
export async function saveOwnMmr(values: {
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Your session expired — please sign in again." };

  const next: MmrInput = {
    peak_2v2:    String(values?.peak_2v2 ?? "").trim(),
    current_2v2: String(values?.current_2v2 ?? "").trim(),
    peak_3v3:    String(values?.peak_3v3 ?? "").trim(),
    current_3v3: String(values?.current_3v3 ?? "").trim(),
  };

  const invalid = validateMmrInput(next);
  if (invalid) return { error: invalid };

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("status, kick_reason, kicked_until")
    .eq("discord_id", session.userId)
    .single();

  if (
    account?.status !== "approved" ||
    isCurrentlyKicked(account.kick_reason ?? null, account.kicked_until ?? null)
  ) {
    return { error: "Only approved players can edit their MMR." };
  }

  const { data: player } = await supabaseAdmin
    .from("players")
    .select(MMR_PLAYER_COLUMNS)
    .eq("discord_id", session.userId)
    .single<MmrPlayerRow>();
  if (!player) return { error: "No player record for your account." };

  const res = await applyMmrChange(player, next, new Date().toISOString());
  if (res.error) return { error: res.error };
  if (!res.changed) return { error: "No changes to save — update a value first." };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/players");
  return { ok: true };
}

export async function requestProfileChange(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; applied?: boolean; requested?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const trackerUrl = (formData.get("tracker_url") as string)?.trim();
  const peak3v3    = (formData.get("peak_3v3")    as string)?.trim();
  const current3v3 = (formData.get("current_3v3") as string)?.trim();
  const peak2v2    = (formData.get("peak_2v2")    as string)?.trim();
  const current2v2 = (formData.get("current_2v2") as string)?.trim();
  const subWilling = formData.get("sub_willing") === "on";

  if (!trackerUrl || !peak3v3 || !current3v3 || !peak2v2 || !current2v2)
    return { error: "All fields are required." };

  try { new URL(trackerUrl); } catch {
    return { error: "Please enter a valid tracker URL." };
  }

  const nextMmr: MmrInput = {
    peak_3v3:    peak3v3,
    current_3v3: current3v3,
    peak_2v2:    peak2v2,
    current_2v2: current2v2,
  };

  const invalidMmr = validateMmrInput(nextMmr);
  if (invalidMmr) return { error: invalidMmr };

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("status, kick_reason, kicked_until")
    .eq("discord_id", session.userId)
    .single();

  if (account?.status !== "approved" || isCurrentlyKicked(account.kick_reason ?? null, account.kicked_until ?? null)) redirect("/dashboard");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select(`username, tracker_url, ${MMR_PLAYER_COLUMNS}`)
    .eq("discord_id", session.userId)
    .single<MmrPlayerRow & { username: string | null; tracker_url: string | null }>();
  if (!player) redirect("/dashboard");

  const now = new Date().toISOString();

  // sub_willing is a preference with no competitive impact — apply immediately
  await supabaseAdmin
    .from("players")
    .update({ sub_willing: subWilling, updated_at: now })
    .eq("discord_id", session.userId);

  // MMR is self-reported and applies immediately — only the tracker URL, which
  // is what an admin actually verifies it against, still goes through review.
  const mmrResult = await applyMmrChange(player, nextMmr, now);
  if (mmrResult.error) return { error: mmrResult.error };
  const mmrChanged = mmrResult.changed;

  const trackerChanged = trackerUrl !== (player.tracker_url ?? "").trim();

  if (!trackerChanged) {
    revalidatePath("/dashboard/settings");
    if (!mmrChanged) return { error: "No changes to save — update a value first." };
    return { applied: true };
  }

  // Delete any existing pending request for this player, then insert a fresh one
  await supabaseAdmin
    .from("player_edit_requests")
    .delete()
    .eq("player_id", player.id)
    .eq("status", "pending");

  // The MMR columns are NOT NULL, so the request carries the live values it no
  // longer governs — approval only ever applies tracker_url.
  const { error } = await supabaseAdmin.from("player_edit_requests").insert({
    player_id:   player.id,
    discord_id:  session.userId,
    username:    session.username ?? player.username ?? "Unknown",
    tracker_url: trackerUrl,
    peak_3v3:    peak3v3,
    current_3v3: current3v3,
    peak_2v2:    peak2v2,
    current_2v2: current2v2,
  });

  if (error) return { error: "Failed to submit request. Please try again." };

  revalidatePath("/dashboard/settings");

  pushToAdmins({
    title: "Profile Change Request",
    body: `${session.username ?? "A player"} submitted a tracker URL change request.`,
    url: "/dashboard/admin",
    tag: "profile-request",
  }, "profile_changes").catch(() => {});

  return { applied: mmrChanged, requested: true };
}

// Self-service: a player marks their tracker as re-verified, clearing the
// admin-forced "must update tracker" flag and refreshing tracker_confirmed_at.
export async function confirmTrackerCurrent(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { error } = await supabaseAdmin
    .from("players")
    .update({
      tracker_confirmed_at: new Date().toISOString(),
      must_update_tracker: false,
      updated_at: new Date().toISOString(),
    })
    .eq("discord_id", session.userId);

  if (error) return { error: "Failed to confirm tracker." };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function saveNotificationPrefs(
  prefs: Record<string, boolean>
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("status, kick_reason, kicked_until")
    .eq("discord_id", session.userId)
    .single();

  if (account?.status !== "approved" || isCurrentlyKicked(account.kick_reason ?? null, account.kicked_until ?? null)) redirect("/dashboard");

  const { error } = await supabaseAdmin
    .from("players")
    .update({ notification_prefs: prefs, updated_at: new Date().toISOString() })
    .eq("discord_id", session.userId);

  if (error) return { error: "Failed to save preferences." };
  return { ok: true };
}

export async function dismissRejectedRequest(
  requestId: string
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players").select("id").eq("discord_id", session.userId).single();
  if (!player) return { error: "Player not found." };

  await supabaseAdmin
    .from("player_edit_requests")
    .delete()
    .eq("id", requestId)
    .eq("player_id", player.id)
    .eq("status", "rejected");

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function cancelProfileRequest(
  requestId: string
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players").select("id").eq("discord_id", session.userId).single();
  if (!player) return { error: "Player not found." };

  const { error } = await supabaseAdmin
    .from("player_edit_requests")
    .delete()
    .eq("id", requestId)
    .eq("player_id", player.id)
    .eq("status", "pending");

  if (error) return { error: "Failed to cancel request." };

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function saveDisplayName(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const raw = (formData.get("display_name") as string ?? "").trim();

  if (raw.length > 30) return { error: "Nickname must be 30 characters or fewer." };
  if (/@everyone|@here|<@/i.test(raw)) return { error: "Nickname cannot contain Discord mentions." };

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("id, status, kick_reason, kicked_until")
    .eq("discord_id", session.userId)
    .single();

  if (account?.status !== "approved" || isCurrentlyKicked(account.kick_reason ?? null, account.kicked_until ?? null)) redirect("/dashboard");

  const display_name = raw.length > 0 ? raw : null;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("accounts")
    .update({ display_name, updated_at: now })
    .eq("id", account.id);

  if (error) return { error: "Failed to save nickname." };

  // Mirrored onto the Tier 3 row — plenty of not-yet-migrated surfaces still
  // read names straight off `players` (teams, my-team, draft, …).
  await supabaseAdmin
    .from("players")
    .update({ display_name, updated_at: now })
    .eq("account_id", account.id);

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
