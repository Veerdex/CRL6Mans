import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchPatreonIdentity, refreshPatreonToken, type PatreonTokens } from "@/app/lib/patreon";

type SupporterRow = {
  id: string;
  patreon_access_token: string | null;
  patreon_refresh_token: string | null;
  patreon_token_expires_at: string | null;
};

// Refresh proactively once a token is within an hour of expiry, rather than on
// every run — Patreon's docs don't confirm refresh-token rotation behavior, so
// fewer refreshes means less exposure to a rotation bug. Refresh-on-failure
// below is the fallback if the stored expiry turns out to be wrong.
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

function clearedLinkFields() {
  return {
    patreon_user_id: null,
    patreon_member_id: null,
    patreon_status: null,
    patreon_tier_title: null,
    patreon_entitled_cents: null,
    patreon_lifetime_cents: null,
    patreon_public: false,
    patreon_benefit_prefs: {},
    patreon_access_token: null,
    patreon_refresh_token: null,
    patreon_token_expires_at: null,
    patreon_connected_at: null,
    patreon_last_synced_at: null,
    updated_at: new Date().toISOString(),
  };
}

// What a ban strips. Deliberately not clearedLinkFields(): that one means
// "Patreon rejected the token, the link is gone", while this means "we revoked
// them league-side". The identity fields (patreon_user_id, patreon_member_id,
// patreon_lifetime_cents) survive on purpose — they are what maps a row in the
// admin Patreon section back to a CRL name, and an admin who just banned
// someone still paying needs exactly that mapping to go block them on Patreon.
// Clearing the tokens is what makes the revocation stick: syncSupporterLinks
// only iterates accounts with a non-null refresh token, so it can never write
// their patron status back.
export function revokedPatronFields() {
  return {
    patreon_status: null,
    patreon_tier_title: null,
    patreon_entitled_cents: null,
    patreon_public: false,
    patreon_benefit_prefs: {},
    patreon_access_token: null,
    patreon_refresh_token: null,
    patreon_token_expires_at: null,
    patreon_tier_override: null,
    patreon_tier_override_set_by: null,
    patreon_tier_override_set_at: null,
  };
}

// Refreshes and re-fetches status for every account with a linked Patreon
// account. A refresh failure means Patreon rejected the refresh token
// (revoked by the user, or otherwise invalid) — the link is cleared rather
// than left stale, since there's no way to recover it without the user
// reconnecting from Settings.
export async function syncSupporterLinks(): Promise<{ synced: number; cleared: number }> {
  const { data: rows } = await supabaseAdmin
    .from("accounts")
    .select("id, patreon_access_token, patreon_refresh_token, patreon_token_expires_at")
    .not("patreon_refresh_token", "is", null);

  let synced = 0;
  let cleared = 0;

  for (const row of (rows ?? []) as SupporterRow[]) {
    if (!row.patreon_refresh_token) continue;
    try {
      const expiresAt = row.patreon_token_expires_at ? new Date(row.patreon_token_expires_at).getTime() : 0;
      const needsRefresh = expiresAt - Date.now() < REFRESH_MARGIN_MS;

      let accessToken = row.patreon_access_token;
      let newTokens: PatreonTokens | null = null;

      if (needsRefresh) {
        const result = await refreshPatreonToken(row.patreon_refresh_token);
        if (!result.ok) {
          if (result.revoked) {
            await supabaseAdmin.from("accounts").update(clearedLinkFields()).eq("id", row.id);
            cleared++;
          }
          // transient failure — leave the link intact for the next run
          continue;
        }
        newTokens = result.tokens;
        accessToken = newTokens.accessToken;
      }

      let identity = accessToken ? await fetchPatreonIdentity(accessToken) : null;
      if (!identity && !needsRefresh) {
        const result = await refreshPatreonToken(row.patreon_refresh_token);
        if (!result.ok) {
          if (result.revoked) {
            await supabaseAdmin.from("accounts").update(clearedLinkFields()).eq("id", row.id);
            cleared++;
          }
          continue;
        }
        newTokens = result.tokens;
        accessToken = newTokens.accessToken;
        identity = await fetchPatreonIdentity(accessToken);
      }

      if (!identity) continue; // transient failure — leave it for the next run

      await supabaseAdmin
        .from("accounts")
        .update({
          patreon_user_id: identity.patreonUserId,
          patreon_member_id: identity.memberId,
          patreon_status: identity.status,
          patreon_tier_title: identity.tierTitle,
          patreon_entitled_cents: identity.entitledCents,
          patreon_lifetime_cents: identity.lifetimeCents,
          ...(newTokens
            ? {
                patreon_access_token: newTokens.accessToken,
                patreon_refresh_token: newTokens.refreshToken,
                patreon_token_expires_at: newTokens.expiresAt,
              }
            : {}),
          patreon_last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      synced++;
    } catch {
      // transient failure (network blip, etc.) — leave this account for the
      // next run rather than abandoning the rest of the batch
      continue;
    }
  }

  return { synced, cleared };
}

// Returns a valid campaign-owner access token, refreshing and persisting it
// first if it's near expiry. Returns null if the campaign owner has never
// connected, or if Patreon rejected the refresh (the admin needs to
// reconnect from the admin Data tab).
export async function getFreshCampaignAccessToken(): Promise<{ accessToken: string; campaignId: string } | null> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("patreon_campaign_access_token, patreon_campaign_refresh_token, patreon_campaign_token_expires_at, patreon_campaign_id")
    .single();
  if (!settings?.patreon_campaign_refresh_token || !settings?.patreon_campaign_id) return null;

  const expiresAt = settings.patreon_campaign_token_expires_at
    ? new Date(settings.patreon_campaign_token_expires_at as string).getTime()
    : 0;
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return {
      accessToken: settings.patreon_campaign_access_token as string,
      campaignId: settings.patreon_campaign_id as string,
    };
  }

  const result = await refreshPatreonToken(settings.patreon_campaign_refresh_token as string);
  if (!result.ok) {
    if (result.revoked) {
      // Patreon rejected the refresh token outright — the admin needs to
      // reconnect. A transient failure (network/429/5xx) leaves the stored
      // tokens untouched so the next call can just retry.
      await supabaseAdmin
        .from("league_settings")
        .update({
          patreon_campaign_access_token: null,
          patreon_campaign_refresh_token: null,
          patreon_campaign_token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .not("id", "is", null);
    }
    return null;
  }

  await supabaseAdmin
    .from("league_settings")
    .update({
      patreon_campaign_access_token: result.tokens.accessToken,
      patreon_campaign_refresh_token: result.tokens.refreshToken,
      patreon_campaign_token_expires_at: result.tokens.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .not("id", "is", null);

  return { accessToken: result.tokens.accessToken, campaignId: settings.patreon_campaign_id as string };
}
