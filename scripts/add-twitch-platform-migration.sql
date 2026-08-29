-- Run this in the Supabase SQL editor to allow Twitch clip submissions.
--
-- clips.platform has a check constraint listing the accepted platforms
-- (see scripts/add-clips-migration.sql). This widens it to also accept
-- 'twitch' now that the site classifies and embeds Twitch clip links.

alter table clips drop constraint if exists clips_platform_check;
alter table clips add constraint clips_platform_check
  check (platform in ('youtube', 'medal', 'streamable', 'twitch', 'tiktok', 'twitter', 'instagram'));
