"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { deleteBlobs, deleteDroppedBlobs } from "@/app/lib/blob-cleanup";
import type { ContentCrop, CropKind, MediaCrop } from "@/app/lib/media-crop";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

export type Design = {
  id: string;
  name: string;
  status: "active" | "disabled";
  background_image_url: string | null;
  top_nav_image_url: string | null;
  side_nav_image_url: string | null;
  content_crop: ContentCrop;
  created_at: string;
};

export async function getDesigns(): Promise<Design[]> {
  const session = await getSession();
  if (!session?.userId || !(await isDirectorVerified(session.userId))) return [];

  const { data } = await supabaseAdmin
    .from("designs")
    .select("id, name, status, background_image_url, top_nav_image_url, side_nav_image_url, content_crop, created_at")
    .order("created_at", { ascending: true });
  return (data ?? []) as Design[];
}

export async function createDesign(name: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can add designs." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Design name is required." };

  const { error } = await supabaseAdmin.from("designs").insert({ name: trimmed });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function updateDesignDetails(
  designId: string,
  details: { backgroundImageUrl: string; topNavImageUrl: string; sideNavImageUrl: string }
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit designs." };

  const { data: previous } = await supabaseAdmin
    .from("designs")
    .select("background_image_url, top_nav_image_url, side_nav_image_url")
    .eq("id", designId)
    .single();

  const media = {
    background_image_url: details.backgroundImageUrl.trim() || null,
    top_nav_image_url: details.topNavImageUrl.trim() || null,
    side_nav_image_url: details.sideNavImageUrl.trim() || null,
  };

  const { error } = await supabaseAdmin
    .from("designs")
    .update({ ...media, updated_at: new Date().toISOString() })
    .eq("id", designId);
  if (error) return { error: error.message };

  if (previous) await deleteDroppedBlobs(Object.values(previous), Object.values(media));

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function updateDesignContentCrop(
  designId: string,
  kind: CropKind,
  crop: MediaCrop
): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit designs." };

  const { data: design } = await supabaseAdmin
    .from("designs")
    .select("content_crop")
    .eq("id", designId)
    .single();
  if (!design) return { error: "Design not found." };

  const nextCrop: ContentCrop = { ...((design.content_crop as ContentCrop) ?? {}), [kind]: crop };
  const { error } = await supabaseAdmin
    .from("designs")
    .update({ content_crop: nextCrop, updated_at: new Date().toISOString() })
    .eq("id", designId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function toggleDesignStatus(designId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit designs." };

  const { data: design } = await supabaseAdmin
    .from("designs")
    .select("status")
    .eq("id", designId)
    .single();
  if (!design) return { error: "Design not found." };

  const nextStatus = design.status === "active" ? "disabled" : "active";
  const { error } = await supabaseAdmin
    .from("designs")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", designId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

export async function deleteDesign(designId: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirectorVerified(session.userId))) return { error: "Only Directors can edit designs." };

  const { data: media } = await supabaseAdmin
    .from("designs")
    .select("background_image_url, top_nav_image_url, side_nav_image_url")
    .eq("id", designId)
    .single();

  const { error } = await supabaseAdmin.from("designs").delete().eq("id", designId);
  if (error) return { error: error.message };

  if (media) await deleteBlobs(Object.values(media));

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
