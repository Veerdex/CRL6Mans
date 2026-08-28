"use server";

import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

export async function setPatreonPublic(isPublic: boolean) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  await supabaseAdmin
    .from("accounts")
    .update({ patreon_public: isPublic, updated_at: new Date().toISOString() })
    .eq("discord_id", session.userId);

  return { ok: true };
}

// No documented Patreon revoke-on-our-end endpoint — this just clears the
// local link. The cron will also clear it on its own if Patreon reports the
// refresh token as invalid (e.g. the user revoked from Patreon's side).
export async function disconnectPatreon() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  await supabaseAdmin
    .from("accounts")
    .update({
      patreon_user_id: null,
      patreon_member_id: null,
      patreon_status: null,
      patreon_tier_title: null,
      patreon_entitled_cents: null,
      patreon_lifetime_cents: null,
      patreon_public: false,
      patreon_access_token: null,
      patreon_refresh_token: null,
      patreon_token_expires_at: null,
      patreon_connected_at: null,
      patreon_last_synced_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("discord_id", session.userId);

  return { ok: true };
}
