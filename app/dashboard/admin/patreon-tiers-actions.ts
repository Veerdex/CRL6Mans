"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export type Benefit = {
  id: string;
  name: string;
  description: string;
  created_at: string;
};

export type BenefitInput = {
  name: string;
  description: string;
};

export type Tier = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  benefitIds: string[];
};

export type TierInput = {
  name: string;
  description: string;
  benefitIds: string[];
};

function validateBenefit(input: BenefitInput): string | null {
  if (!input.name.trim()) return "Benefit name is required.";
  if (!input.description.trim()) return "Benefit description is required.";
  return null;
}

function validateTier(input: TierInput): string | null {
  if (!input.name.trim()) return "Tier name is required.";
  if (!input.description.trim()) return "Tier description is required.";
  return null;
}

export async function getLiveTierTitles(): Promise<string[]> {
  const { data } = await supabaseAdmin.from("accounts").select("patreon_tier_title").not("patreon_tier_title", "is", null);
  const titles = new Set((data ?? []).map((r) => r.patreon_tier_title as string));
  return Array.from(titles).sort();
}

export async function getBenefits(): Promise<Benefit[]> {
  const { data } = await supabaseAdmin
    .from("patreon_benefits")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: true });
  return (data ?? []) as Benefit[];
}

export async function getTiers(): Promise<Tier[]> {
  const [{ data: tiers }, { data: links }] = await Promise.all([
    supabaseAdmin.from("patreon_tiers").select("id, name, description, created_at").order("created_at", { ascending: true }),
    supabaseAdmin.from("patreon_tier_benefits").select("tier_id, benefit_id"),
  ]);

  const benefitIdsByTier = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = benefitIdsByTier.get(link.tier_id as string) ?? [];
    list.push(link.benefit_id as string);
    benefitIdsByTier.set(link.tier_id as string, list);
  }

  return ((tiers ?? []) as Omit<Tier, "benefitIds">[]).map((t) => ({
    ...t,
    benefitIds: benefitIdsByTier.get(t.id) ?? [],
  }));
}

export async function createBenefit(input: BenefitInput): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can create benefits." };

  const validationError = validateBenefit(input);
  if (validationError) return { error: validationError };

  const { error } = await supabaseAdmin
    .from("patreon_benefits")
    .insert({ name: input.name.trim(), description: input.description.trim() });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function updateBenefit(id: string, input: BenefitInput): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit benefits." };

  const validationError = validateBenefit(input);
  if (validationError) return { error: validationError };

  const { error } = await supabaseAdmin
    .from("patreon_benefits")
    .update({ name: input.name.trim(), description: input.description.trim(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function deleteBenefit(id: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can delete benefits." };

  const { error } = await supabaseAdmin.from("patreon_benefits").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function createTier(input: TierInput): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can create tiers." };

  const validationError = validateTier(input);
  if (validationError) return { error: validationError };

  const { data, error } = await supabaseAdmin
    .from("patreon_tiers")
    .insert({ name: input.name.trim(), description: input.description.trim() })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (input.benefitIds.length > 0) {
    const { error: linkError } = await supabaseAdmin
      .from("patreon_tier_benefits")
      .insert(input.benefitIds.map((benefit_id) => ({ tier_id: data.id, benefit_id })));
    if (linkError) return { error: linkError.message };
  }

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function updateTier(id: string, input: TierInput): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit tiers." };

  const validationError = validateTier(input);
  if (validationError) return { error: validationError };

  const { error } = await supabaseAdmin
    .from("patreon_tiers")
    .update({ name: input.name.trim(), description: input.description.trim(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  const { error: deleteLinksError } = await supabaseAdmin.from("patreon_tier_benefits").delete().eq("tier_id", id);
  if (deleteLinksError) return { error: deleteLinksError.message };

  if (input.benefitIds.length > 0) {
    const { error: linkError } = await supabaseAdmin
      .from("patreon_tier_benefits")
      .insert(input.benefitIds.map((benefit_id) => ({ tier_id: id, benefit_id })));
    if (linkError) return { error: linkError.message };
  }

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function deleteTier(id: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can delete tiers." };

  const { error } = await supabaseAdmin.from("patreon_tiers").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}
