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
  const { data, error } = await supabaseAdmin
    .from("players")
    .update({ ...pickEditableFields(fields), status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("discord_id")
    .single();
  if (error) return { error: error.message };
  if (data?.discord_id) await addRegisteredRole(data.discord_id);
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
    .from("players")
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
  const { error } = await supabaseAdmin
    .from("players")
    .update({ ...pickEditableFields(fields), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  return { ok: true };
}
