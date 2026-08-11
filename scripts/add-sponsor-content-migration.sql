-- ─────────────────────────────────────────────────────────────
-- SPONSORS — content columns (additive migration, Phase 2)
--
-- Adds the fields needed to actually present a sponsor: tier (small/big),
-- a logo and a video (each a URL regardless of whether it was pasted or
-- came from a direct file upload to Blob storage), a list of links, and
-- a promo code.
--
-- Safe to run against a live DB — pure additive `add column if not exists`.
-- ─────────────────────────────────────────────────────────────

alter table sponsors add column if not exists tier text not null default 'small' check (tier in ('small', 'big'));
alter table sponsors add column if not exists logo_url text;
alter table sponsors add column if not exists video_url text;
alter table sponsors add column if not exists links jsonb not null default '[]';
alter table sponsors add column if not exists promo_code text;
