-- Track which of an event's two exports have been taken, so the heavy
-- full_archive jsonb can be dropped once both files are on an admin's disk.
--
-- Until this runs, the columns read back as undefined, markEventDownloaded's
-- update fails harmlessly, and nothing is ever purged. That is the safe
-- default: no archive is destroyed by deploying the code alone.
--
-- Events completed before this migration have no marks, so they keep their
-- archive until both files are downloaded again.

alter table tournaments add column if not exists pdf_downloaded_at     timestamptz;
alter table tournaments add column if not exists archive_downloaded_at timestamptz;

alter table seasons     add column if not exists pdf_downloaded_at     timestamptz;
alter table seasons     add column if not exists archive_downloaded_at timestamptz;

-- How much the purge stands to reclaim, largest first. Postgres frees a
-- TOASTed jsonb for reuse on autovacuum rather than returning it to the OS, so
-- expect the reported database size to hold steady while headroom grows.
-- Ordered by the raw byte count, not the pretty string -- sorting the latter as
-- text puts "9 kB" above "120 MB".
select 'tournaments' as table_name, name,
       pg_size_pretty(pg_column_size(full_archive)::bigint) as archive_size,
       pg_column_size(full_archive)::bigint as bytes
  from tournaments where full_archive is not null
union all
select 'seasons', name,
       pg_size_pretty(pg_column_size(full_archive)::bigint),
       pg_column_size(full_archive)::bigint
  from seasons where full_archive is not null
order by bytes desc;
