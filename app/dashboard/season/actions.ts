"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
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
} from "@/app/lib/bracket-server";

export async function saveSeasonFormat(config: SeasonFormatConfig): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

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
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveBracket();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceGroupsToSE(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveSEFromGroups();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceGroupsToSwiss(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveSwissFromGroups();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceSwissRound(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveNextSwissRound();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceSEQualifierToSwiss(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveSwissFromSEQualifier();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceSwissToSE(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveSEFromSwiss();
  revalidatePath("/dashboard/season");
  return result;
}

export async function advanceDEQualifierToSwiss(): Promise<{ error?: string; ok?: boolean }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const result = await buildAndSaveSwissFromDEQualifier();
  revalidatePath("/dashboard/season");
  return result;
}
