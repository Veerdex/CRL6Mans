import { supabaseAdmin } from "@/app/lib/supabase";

export async function getPatreonUrl(): Promise<string | null> {
  const { data } = await supabaseAdmin.from("league_settings").select("patreon_url").single();
  return (data?.patreon_url as string | null) ?? null;
}
