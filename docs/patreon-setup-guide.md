# Patreon Integration Setup Guide

This walks through connecting the CRL West 6Mans Patreon campaign to the website: registering the OAuth client on Patreon's side, wiring up the environment variables, running the database migration, and making the one-time "campaign connect" that lets the admin **Data → Patrons** tab see every patron (not just the ones who link their own account from Settings).

Do every step below **while logged into the Patreon account that actually owns/administers the CRL West 6Mans campaign.** Registering the client under a different account is the single most common way this breaks — see the troubleshooting note at the end.

---

## 1. Run the database migration

Before touching Patreon at all, add the columns the integration needs.

1. Open the Supabase project's **SQL Editor**.
2. Open `scripts/add-patreon-accounts-migration.sql` from the repo, copy its contents, and run it.

This adds the per-player link columns to `accounts` (`patreon_user_id`, `patreon_status`, `patreon_tier_title`, tokens, etc.) and the one-time campaign-owner token columns to `league_settings`. Nothing in the steps below will work until this has run.

---

## 2. Register the OAuth client on Patreon

1. Go to **[patreon.com/portal](https://www.patreon.com/portal)** and log in as the campaign-owning account.
2. Navigate to **Clients & API Keys** (Patreon's "Register a Client" page) and create a new **API v2** OAuth client.
3. Give it a name (e.g. "CRL West 6Mans") — this is just a label shown on Patreon's consent screen, not something that appears on our site.
4. In the **Redirect URIs** field, add **both** of these (one client handles both flows this integration uses):
   - `https://<your-domain>/api/auth/patreon/callback` — the per-player "connect my account" flow
   - `https://<your-domain>/api/auth/patreon-admin/callback` — the one-time campaign-wide connect
   - If you're testing locally first, also add the `http://localhost:3000/...` versions of both.
5. Save. Patreon will show you a **Client ID** and **Client Secret** — copy both somewhere safe, you'll need them in the next step.

> Don't launch/finish setting up your creator page for this — the client works as long as the campaign exists, regardless of its public launch status.

---

## 3. Set the environment variables

Add these to `.env.local` for local testing, and to **Vercel → Project Settings → Environment Variables** for the live site (same as every other secret in this project — `.env.local` is never deployed).

```env
# Patreon OAuth
PATREON_CLIENT_ID=
PATREON_CLIENT_SECRET=
PATREON_REDIRECT_URI=https://<your-domain>/api/auth/patreon/callback
PATREON_ADMIN_REDIRECT_URI=https://<your-domain>/api/auth/patreon-admin/callback

# Optional — only needed if the per-supporter `identity` scope doesn't
# auto-filter to just this campaign (see step 5's note)
# PATREON_CAMPAIGN_ID=
# PATREON_SUPPORTER_SCOPE=identity
```

- `PATREON_CLIENT_ID` / `PATREON_CLIENT_SECRET` — from step 2.
- `PATREON_REDIRECT_URI` / `PATREON_ADMIN_REDIRECT_URI` — **must exactly match** what you entered in Patreon's Redirect URIs field, including the scheme (`http` vs `https`) and trailing path. A mismatch here is a common source of OAuth failures.
- Leave `PATREON_CAMPAIGN_ID` and `PATREON_SUPPORTER_SCOPE` commented out for now — only come back to them if step 6's live test shows they're needed.

No new `CRON_SECRET` is required — the daily sync job (`/api/cron/patreon-sync`) reuses the `CRON_SECRET` this project already has for the other cron routes.

Restart the dev server (or redeploy on Vercel) after setting these so the new values are picked up.

---

## 4. Do the one-time campaign connect

This is the step that unlocks the *full* patron list in the admin dashboard, as opposed to only seeing players who've individually connected.

1. Log into the website as a **director or CEO**.
2. Go to **Admin → Data → Patrons**.
3. Click **Connect Campaign**. You'll be redirected to Patreon's consent screen — approve it while logged in as the same campaign-owning account from step 2.
4. You should land back on the admin Data tab with the campaign now connected — a **Sync now** button replaces the Connect Campaign link, and the patron list should populate (it may show 0 patrons if the campaign doesn't have any yet, which is expected).

If this step 500s, see **Troubleshooting** below before going further.

---

## 5. (Optional but recommended) verify the per-player connect flow

1. As any player, go to **Settings** and click **Connect Patreon**.
2. Approve the consent screen (bare `identity` scope this time, not the campaign-wide one).
3. Confirm your Patreon status/tier shows up on the Settings page.
4. Toggle **"Show me publicly on Support Us"** on, then check `/dashboard/support` — you should appear in the "Our Patrons" list. Toggle it off and confirm you disappear.

This also validates the one open question in this integration: whether requesting bare `identity` scope is enough for Patreon to auto-scope the returned membership data to just this campaign. If your Settings page shows *no* membership data even though you're a confirmed patron of this campaign, uncomment `PATREON_CAMPAIGN_ID` and set `PATREON_SUPPORTER_SCOPE=identity identity.memberships` in your env vars, then try again.

---

## 6. Confirm the daily sync works

The nightly cron (`/api/cron/patreon-sync`) keeps everyone's status fresh without anyone needing to click anything. Cron jobs don't run locally, so test it directly:

```bash
curl -H "Authorization: Bearer <your CRON_SECRET>" https://<your-domain>/api/cron/patreon-sync
```

A successful response looks like `{"ok":true,"supporters":{"synced":N,"cleared":0},"campaignTokenFresh":true}`. If `cleared` is ever non-zero, it means Patreon rejected a stored refresh token for that many accounts (they'll need to reconnect from Settings) — `synced: 0, cleared: 0` on a fresh setup with no connected players yet is normal.

---

## Troubleshooting

**"Server responded with 500" when clicking Connect Campaign** — almost always means `PATREON_CLIENT_ID` or `PATREON_ADMIN_REDIRECT_URI` isn't set in the environment you're testing against (check DevTools → Network → the failed request's response body; it'll literally say `"Server misconfiguration"` if this is the cause). Double-check step 3, and make sure you restarted/redeployed after setting them.

**Connect Campaign succeeds but the patron list stays empty / falls back to "partial data"** — the OAuth client in step 2 was likely registered under a different Patreon account than the one that owns the campaign. Re-register the client (or re-authorize) using the actual campaign-owner account.

**A player's Settings page shows "connected" but no tier/status** — see the note at the end of step 5 about `PATREON_CAMPAIGN_ID` / `PATREON_SUPPORTER_SCOPE`.
