-- ─────────────────────────────────────────────────────────────
-- SPONSOR CONTENT CROP — pan/zoom framing for logo/topNav/sideNav
--
-- Lets an admin adjust how a sponsor's logo, top-nav image, and side-nav
-- image are framed (pan position + zoom) via the Preview tool in the
-- admin Sponsors editor, instead of always being locked to a centered
-- "cover" fit.
--
--   sponsors.content_crop — jsonb, keyed by content kind:
--     { "logo"?: {x,y,zoom}, "topNav"?: {x,y,zoom}, "sideNav"?: {x,y,zoom} }
--   x/y are 0-100 (percent position within the image), zoom is >= 1.
--   A missing key means "not customized yet" — falls back to centered,
--   no-zoom (x:50, y:50, zoom:1), identical to today's fixed behavior.
--
-- Run this in the Supabase SQL editor BEFORE deploying the app code that
-- reads/writes this column.
-- ─────────────────────────────────────────────────────────────

alter table sponsors add column if not exists content_crop jsonb not null default '{}';
