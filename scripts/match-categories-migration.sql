-- Run this in the Supabase SQL editor.
-- Adds dynamic per-stage Discord category tracking and channel ID storage on matches.

create table if not exists match_discord_categories (
  id                  uuid        primary key default gen_random_uuid(),
  discord_category_id text        not null unique,
  label               text        not null,
  stage               text        not null,
  round               integer,    -- null for group stages (whole group in one category)
  bucket              text,       -- swiss only: "W-L" string e.g. "1-0"; null otherwise
  created_at          timestamptz not null default now()
);

create index if not exists mdc_stage_round_idx on match_discord_categories(stage, round);

-- Store which Discord channel was created for each match (enables targeted cleanup)
alter table matches add column if not exists discord_channel_id text;
