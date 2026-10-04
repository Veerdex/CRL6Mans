import { supabaseAdmin } from "@/app/lib/supabase";

export const WELCOME_SEEN_COOKIE = "welcome_seen";
export const WELCOME_SEEN_MAX_AGE = 60 * 60 * 24 * 365 * 5;

// The cookie is only a fast path; accounts.welcome_seen_at is the record, so
// losing the cookie (new device, installed app, cleared data) doesn't bring the
// tab back. A read error means the migration hasn't run — fall back to the cookie.
export async function hasSeenWelcome(userId: string, cookieValue: string | undefined): Promise<boolean> {
  if (cookieValue === "1") return true;
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("welcome_seen_at")
    .eq("discord_id", userId)
    .maybeSingle();
  if (error) return false;
  return !!data?.welcome_seen_at;
}
