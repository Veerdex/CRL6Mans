"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified, addRegisteredRole } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { kickForRejectionCooldown, type RejectionCooldown } from "./player-moderation-actions";

export type PlayerEditFields = {
  username: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  tracker_url: string;
};

async function assertAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
}

// Pick only the columns an admin is allowed to edit, so a crafted payload can't
// mass-assign other player columns (status, team_id, is_captain, …) via spread.
function pickEditableFields(fields: PlayerEditFields): PlayerEditFields {
  return {
    username:    fields.username,
    peak_3v3:    fields.peak_3v3,
    current_3v3: fields.current_3v3,
    peak_2v2:    fields.peak_2v2,
    current_2v2: fields.current_2v2,
    tracker_url: fields.tracker_url,
  };
}

function validateMmrFields(fields: PlayerEditFields): string | null {
  const mmrKeys: Array<keyof PlayerEditFields> = ["peak_3v3", "current_3v3", "peak_2v2", "current_2v2"];
  for (const key of mmrKeys) {
    const raw = fields[key];
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || !Number.isInteger(n) || n < 0)
      return `${key.replace(/_/g, " ")} must be a non-negative integer.`;
  }
  if (Number(fields.current_3v3) > Number(fields.peak_3v3))
    return "Current 3v3 MMR cannot exceed Peak 3v3.";
  if (Number(fields.current_2v2) > Number(fields.peak_2v2))
    return "Current 2v2 MMR cannot exceed Peak 2v2.";
  return null;
}

export async function approvePlayerWithEdits(
  id: string,
  fields: PlayerEditFields
): Promise<{ error?: string; ok?: boolean }> {
  await assertAdmin();
  const mmrError = validateMmrFields(fields);
  if (mmrError) return { error: mmrError };
  const editable = pickEditableFields(fields);
  const now = new Date().toISOString();

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, display_name")
    .eq("id", id)
    .single();
  if (!account?.discord_id) return { error: "Account not found." };

  // Tier 2 (pending_players) stays the source of truth for MMR/tracker going
  // forward. college_image_url/sub_willing/tracker_confirmed_at are read back
  // here so the new Tier 3 row can seed from them below.
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from("pending_players")
    .update({
      peak_3v3: editable.peak_3v3,
      current_3v3: editable.current_3v3,
      peak_2v2: editable.peak_2v2,
      current_2v2: editable.current_2v2,
      tracker_url: editable.tracker_url,
      updated_at: now,
    })
    .eq("account_id", id)
    .select("college_image_url, sub_willing, tracker_confirmed_at")
    .single();
  if (pendingError) return { error: pendingError.message };

  // Tier 3 (players) is created here, id = account id. Many not-yet-migrated
  // call sites (draft/bracket/team-balancing logic) still read MMR straight off
  // `players`, so those columns are mirrored here rather than left at defaults.
  const { error: insertError } = await supabaseAdmin.from("players").upsert(
    {
      id,
      account_id: id,
      discord_id: account.discord_id,
      username: editable.username,
      display_name: account.display_name ?? null,
      status: "approved",
      peak_3v3: editable.peak_3v3,
      current_3v3: editable.current_3v3,
      peak_2v2: editable.peak_2v2,
      current_2v2: editable.current_2v2,
      tracker_url: editable.tracker_url,
      college_image_url: pending?.college_image_url ?? "",
      sub_willing: pending?.sub_willing ?? false,
      tracker_confirmed_at: pending?.tracker_confirmed_at ?? null,
      updated_at: now,
    },
    { onConflict: "id" }
  );
  if (insertError) return { error: insertError.message };

  const { error: statusError } = await supabaseAdmin
    .from("accounts")
    .update({ username: editable.username, status: "approved", updated_at: now })
    .eq("id", id);
  if (statusError) return { error: statusError.message };

  await addRegisteredRole(account.discord_id);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function rejectPlayer(
  id: string,
  adminNote?: string,
  cooldown?: RejectionCooldown
): Promise<{ error?: string; ok?: boolean }> {
  await assertAdmin();
  const { error } = await supabaseAdmin
    .from("accounts")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { error: error.message };

  if (cooldown) {
    const cooldownResult = await kickForRejectionCooldown(
      id,
      adminNote?.trim() || "Registration rejected.",
      cooldown
    );
    if (cooldownResult.error) return { error: `Registration rejected, but the cooldown failed: ${cooldownResult.error}` };
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function updatePlayerData(
  id: string,
  fields: PlayerEditFields
): Promise<{ error?: string; ok?: boolean }> {
  await assertAdmin();
  const mmrError = validateMmrFields(fields);
  if (mmrError) return { error: mmrError };
  const editable = pickEditableFields(fields);
  const now = new Date().toISOString();

  const { error: pendingError } = await supabaseAdmin
    .from("pending_players")
    .update({
      peak_3v3: editable.peak_3v3,
      current_3v3: editable.current_3v3,
      peak_2v2: editable.peak_2v2,
      current_2v2: editable.current_2v2,
      tracker_url: editable.tracker_url,
      updated_at: now,
    })
    .eq("account_id", id);
  if (pendingError) return { error: pendingError.message };

  // Mirrored onto `players` too — see approvePlayerWithEdits for why.
  const { error } = await supabaseAdmin
    .from("players")
    .update({ ...editable, updated_at: now })
    .eq("id", id);
  if (error) return { error: error.message };

  const { error: accountError } = await supabaseAdmin
    .from("accounts")
    .update({ username: editable.username, updated_at: now })
    .eq("id", id);
  if (accountError) return { error: accountError.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}
