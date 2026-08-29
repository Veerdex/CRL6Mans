-- Run this in the Supabase SQL editor to let admins download the raw .replay
-- file for a match game that failed identity certification, instead of only
-- seeing the parser's extracted evidence on the discrepancy card.
--
-- Only replays that fail certification get stored (uploadGameReplay uploads
-- the file after the fact, keyed by replay_id) — certified games are the
-- common case and storing every one of them would burn through the 1 GB
-- Supabase Storage free-tier cap for no admin-facing benefit.

alter table replay_identity_certifications add column if not exists replay_file_path text;

insert into storage.buckets (id, name, public)
values ('match-replays', 'match-replays', false)
on conflict (id) do update set public = excluded.public;
