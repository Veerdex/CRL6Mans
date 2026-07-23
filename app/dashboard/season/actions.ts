"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import type { SeasonFormatConfig } from "./format-editor";
import {
  buildAndSaveBracket,
  buildAndSaveSEFromGroups,
  buildAndSaveSwissFromGroups,
  buildAndSaveNextSwissRound,
  buildAndSaveSEFromSwiss,
  buildAndSaveSwissFromSEQualifier,
  buildAndSaveSwissFromDEQualifier,
  buildAndSaveSwissFromGroupsHybrid,
  buildAndSaveHybridFromSwiss,
  buildAndSaveSwissFromGroupsHybrid8,
  buildAndSaveHybrid8FromSwiss,
} from "@/app/lib/bracket-server";
import { openReadyMatchChannels } from "@/app/lib/discord-bot";

// Director-gated stage/round advance: runs the bracket-server builder, then opens
// Discord channels for any newly-ready matches (so rounds flow without /openround).
// In testing mode, bypasses the previous round's schedule deadline the same way
// Simulate does, so admins can advance stages/rounds back-to-back without waiting
// out real-world round windows.
async function runStageAdvance(
  fn: () => Promise<{ error?: string; ok?: boolean }>,
): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
  const testingMode = cookieStore.get("testing_mode")?.value === "1";

  const result = await fn();
  if (result.ok) await openReadyMatchChannels({ ignoreScheduleDeadline: testingMode });
  revalidatePath("/dashboard/season");
  return result;
}

export async function saveSeasonFormat(config: SeasonFormatConfig): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");

  if (!config?.preset) return { error: "Select a format preset." };

  if (config.groupMaxAdvancing != null) {
    if (!Number.isInteger(config.groupMaxAdvancing) || config.groupMaxAdvancing < 2) {
      return { error: "groupMaxAdvancing must be an integer ≥ 2." };
    }
    const { data: settings } = await supabaseAdmin
      .from("league_settings").select("num_teams").single();
    const n = (settings?.num_teams as number) ?? 0;
    if (n > 0) {
      const numGroups = n > 32 ? 8 : n > 16 ? 4 : 2;
      if (config.groupMaxAdvancing % numGroups !== 0) {
        return { error: `groupMaxAdvancing must be a multiple of ${numGroups} (groups for ${n} teams).` };
      }
      const maxAllowed = Math.floor(Math.floor((n * 3) / 4) / numGroups) * numGroups;
      if (config.groupMaxAdvancing > maxAllowed) {
        return { error: `groupMaxAdvancing cannot exceed ${maxAllowed} for ${n} teams.` };
      }
    }
  }

  if (config.groupRounds != null) {
    if (!Number.isInteger(config.groupRounds) || config.groupRounds < 1 || config.groupRounds > 30) {
      return { error: "groupRounds must be an integer between 1 and 30." };
    }
  }

  const { error } = await supabaseAdmin.from("league_settings").upsert({
    id: 1,
    season_format: config,
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return { ok: true };
}

export async function generateBracketForSeason(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");

  const result = await buildAndSaveBracket();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceGroupsToSE() { return runStageAdvance(buildAndSaveSEFromGroups); }
export async function advanceGroupsToSwiss() { return runStageAdvance(buildAndSaveSwissFromGroups); }
export async function advanceSwissRound() { return runStageAdvance(buildAndSaveNextSwissRound); }
export async function advanceSEQualifierToSwiss() { return runStageAdvance(buildAndSaveSwissFromSEQualifier); }
export async function advanceSwissToSE() { return runStageAdvance(buildAndSaveSEFromSwiss); }
export async function advanceDEQualifierToSwiss() { return runStageAdvance(buildAndSaveSwissFromDEQualifier); }
export async function advanceGroupsToSwissHybrid() { return runStageAdvance(buildAndSaveSwissFromGroupsHybrid); }
export async function advanceSwissToHybrid() { return runStageAdvance(buildAndSaveHybridFromSwiss); }
export async function advanceGroupsToSwissHybrid8() { return runStageAdvance(buildAndSaveSwissFromGroupsHybrid8); }
export async function advanceSwissToHybrid8() { return runStageAdvance(buildAndSaveHybrid8FromSwiss); }
