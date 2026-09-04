"use server";

import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { PATREON_BENEFITS, isAlwaysOnBenefit } from "@/app/lib/patreon-benefits";
import { benefitPrefTarget } from "@/app/lib/patreon-entitlements";
import { DISCORD_ROLE_BENEFIT, syncDiscordSupporterRole } from "@/app/lib/patreon-discord-role";
import { normalizeNameColor } from "@/app/lib/name-color";
import { GLINT_MAX_COLORS, GLINT_MIN_COLORS, normalizeGlintColors } from "@/app/lib/name-glint";
import { getAvatarBorder } from "@/app/lib/avatar-borders";

// Per-benefit opt-in — the only writer of a patron's benefit switches, which
// is why featured-on-support-page's legacy patreon_public column is reached
// through benefitPrefTarget here rather than through a second action.
//
// Entitlement is not re-checked: the read path already ANDs entitlement with
// the pref, so a stored "on" for a benefit the patron's tier no longer grants
// resolves to nothing, and the action never refuses a toggle the UI just
// rendered. Validating against the catalog is what keeps arbitrary keys out of
// the JSONB map.
export async function setBenefitEnabled(benefitId: string, enabled: boolean) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };
  if (!PATREON_BENEFITS.some((b) => b.id === benefitId)) return { error: "Unknown benefit." };
  if (isAlwaysOnBenefit(benefitId)) return { error: "That benefit cannot be turned off." };

  const updatedAt = new Date().toISOString();

  if (benefitPrefTarget(benefitId) === "public_column") {
    await supabaseAdmin
      .from("accounts")
      .update({ patreon_public: enabled, updated_at: updatedAt })
      .eq("discord_id", session.userId);
    return { ok: true };
  }

  // Read-merge-write rather than accepting a whole map from the client: every
  // row fires its own action, so two quick toggles would otherwise clobber
  // each other.
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("patreon_benefit_prefs")
    .eq("discord_id", session.userId)
    .maybeSingle();

  const prefs = {
    ...((account?.patreon_benefit_prefs as Record<string, boolean> | null) ?? {}),
    [benefitId]: enabled,
  };

  await supabaseAdmin
    .from("accounts")
    .update({ patreon_benefit_prefs: prefs, updated_at: updatedAt })
    .eq("discord_id", session.userId);

  // The one benefit whose state lives outside our database. Reconciled inline
  // rather than in after() so the router.refresh() the card fires next cannot
  // render a switch Discord has not caught up to yet.
  if (benefitId === DISCORD_ROLE_BENEFIT) await syncDiscordSupporterRole(session.userId);

  return { ok: true };
}

// The Colored Name benefit's per-patron value. Entitlement is not re-checked
// here for the same reason setBenefitEnabled does not: the read path ANDs the
// stored colour with the entitlement, so a colour left behind by a lapsed tier
// renders nothing. Normalising is what keeps arbitrary strings out of the
// column that later goes straight into an inline style.
export async function setNameColor(color: string, outline: boolean) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  const hex = normalizeNameColor(color);
  if (!hex) return { error: "Pick a valid colour." };

  await supabaseAdmin
    .from("accounts")
    .update({
      patreon_name_color: hex,
      patreon_name_outline: outline,
      updated_at: new Date().toISOString(),
    })
    .eq("discord_id", session.userId);

  return { ok: true };
}

// The Custom Name Glint benefit's per-patron colours, in pick order: the order
// is what the sweep animates through. Entitlement is not re-checked, for the
// same reason as setNameColor. The 2-4 count is enforced here as well as on
// read so the column never holds a list the picker could not have produced.
export async function setNameGlint(colors: string[]) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  const hexes = normalizeGlintColors(colors);
  if (!hexes) return { error: `Pick ${GLINT_MIN_COLORS} to ${GLINT_MAX_COLORS} valid colours.` };

  await supabaseAdmin
    .from("accounts")
    .update({ patreon_name_glint: hexes, updated_at: new Date().toISOString() })
    .eq("discord_id", session.userId);

  return { ok: true };
}

// The Avatar Border benefit's per-patron value. Stored as a catalog id and
// validated against the catalog, so the column can only ever hold a border that
// exists — the read path does the same check again, since a border retired
// after this was written would otherwise resolve to a 404 image.
export async function setAvatarBorder(borderId: string | null) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return { error: "Not signed in." };

  if (borderId !== null && !getAvatarBorder(borderId)) return { error: "Unknown border." };

  await supabaseAdmin
    .from("accounts")
    .update({ patreon_avatar_border: borderId, updated_at: new Date().toISOString() })
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
      patreon_benefit_prefs: {},
      patreon_name_color: null,
      patreon_name_outline: false,
      patreon_name_glint: null,
      patreon_avatar_border: null,
      patreon_access_token: null,
      patreon_refresh_token: null,
      patreon_token_expires_at: null,
      patreon_connected_at: null,
      patreon_last_synced_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("discord_id", session.userId);

  await syncDiscordSupporterRole(session.userId);

  return { ok: true };
}
