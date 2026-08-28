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

export type Theme = {
  id: string;
  name: string;
  mode: "light" | "dark";
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  shell: string;
  created_at: string;
};

export type ThemeInput = {
  name: string;
  mode: "light" | "dark";
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  shell: string;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function validate(input: ThemeInput): string | null {
  if (!input.name.trim()) return "Theme name is required.";
  const colors = [input.bg, input.surface, input.border, input.text, input.muted, input.accent, input.secondary, input.shell];
  if (colors.some((c) => !HEX_COLOR.test(c))) return "All colors must be valid hex values.";
  if (input.mode !== "light" && input.mode !== "dark") return "Invalid mode.";
  return null;
}

export async function getThemes(): Promise<Theme[]> {
  const { data } = await supabaseAdmin
    .from("themes")
    .select("id, name, mode, bg, surface, border, text, muted, accent, secondary, shell, created_at")
    .order("created_at", { ascending: true });
  return (data ?? []) as Theme[];
}

export async function createTheme(input: ThemeInput): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can create themes." };

  const validationError = validate(input);
  if (validationError) return { error: validationError };

  const { error } = await supabaseAdmin.from("themes").insert({
    name: input.name.trim(),
    mode: input.mode,
    bg: input.bg,
    surface: input.surface,
    border: input.border,
    text: input.text,
    muted: input.muted,
    accent: input.accent,
    secondary: input.secondary,
    shell: input.shell,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function updateTheme(id: string, input: ThemeInput): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit themes." };

  const validationError = validate(input);
  if (validationError) return { error: validationError };

  const { error } = await supabaseAdmin
    .from("themes")
    .update({
      name: input.name.trim(),
      mode: input.mode,
      bg: input.bg,
      surface: input.surface,
      border: input.border,
      text: input.text,
      muted: input.muted,
      accent: input.accent,
      secondary: input.secondary,
      shell: input.shell,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function deleteTheme(id: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can delete themes." };

  const { error } = await supabaseAdmin.from("themes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/sponsors");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
