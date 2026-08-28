-- Per-supporter Patreon link (piece 1) — one player connects their own Patreon
-- account. Lives on `accounts` since Patreon support is an account-identity
-- concept, not gated on roster/registration approval.
alter table accounts add column if not exists patreon_user_id text;
alter table accounts add column if not exists patreon_member_id text;
alter table accounts add column if not exists patreon_status text;
alter table accounts add column if not exists patreon_tier_title text;
alter table accounts add column if not exists patreon_entitled_cents integer;
alter table accounts add column if not exists patreon_lifetime_cents integer;
alter table accounts add column if not exists patreon_public boolean not null default false;
alter table accounts add column if not exists patreon_access_token text;
alter table accounts add column if not exists patreon_refresh_token text;
alter table accounts add column if not exists patreon_token_expires_at timestamptz;
alter table accounts add column if not exists patreon_connected_at timestamptz;
alter table accounts add column if not exists patreon_last_synced_at timestamptz;

-- Campaign-owner Patreon link (piece 2) — one-time admin connection so the
-- admin Data tab can show every patron, not just the ones who linked their own
-- account. Single-row config, same convention as other league_settings fields.
alter table league_settings add column if not exists patreon_campaign_access_token text;
alter table league_settings add column if not exists patreon_campaign_refresh_token text;
alter table league_settings add column if not exists patreon_campaign_token_expires_at timestamptz;
alter table league_settings add column if not exists patreon_campaign_id text;
