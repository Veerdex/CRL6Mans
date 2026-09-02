-- accounts.theme must accept the sponsor theme
--
-- The sponsor theme was added to `players.theme` before the tiered-accounts
-- migration, so `accounts_theme_check` still only allows light/dark/crl6mans.
-- setTheme now writes the Tier 1 copy (the OAuth callback reads it back on
-- every login), so without this the sponsor theme is rejected on save.
--
-- Run once, before deploying the setTheme change.

alter table accounts drop constraint if exists accounts_theme_check;
alter table accounts add constraint accounts_theme_check
  check (theme in ('light', 'dark', 'crl6mans', 'sponsor'));
