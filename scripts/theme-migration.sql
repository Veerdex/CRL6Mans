-- Run this in the Supabase SQL editor.
-- Per-player UI theme: 'light', 'dark', or 'crl6mans' (the blue/orange brand theme).
-- CRL6Mans is the default for everyone.

alter table players add column if not exists theme text not null default 'crl6mans';

-- Ensure the default + allowed values are current even if an older version ran.
alter table players alter column theme set default 'crl6mans';
alter table players drop constraint if exists players_theme_check;
alter table players add constraint players_theme_check
  check (theme in ('light', 'dark', 'crl6mans'));
