-- Adds the column backing the website's admin 2FA gate. Populated from Discord's
-- own mfa_enabled field on every OAuth login (see app/api/auth/discord/callback),
-- and re-checked fresh from the DB on every dashboard request rather than being
-- baked into the session JWT, so a staff member who disables Discord 2FA loses
-- website admin access on their very next page load.
alter table players add column if not exists mfa_enabled boolean not null default false;
