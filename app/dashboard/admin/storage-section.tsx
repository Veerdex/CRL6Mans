import { unstable_cache } from "next/cache";
import { list } from "@vercel/blob";
import { supabaseAdmin } from "@/app/lib/supabase";
import { AdminSubSection } from "./admin-sub-section";
import { LocalTime } from "@/app/dashboard/local-time";

// Hobby includes 1 GB, not the 5 GB this used to claim. The changelog that
// sounds like it says otherwise ("Increased Blob store limit for Hobby users",
// June 2026) raised the number of stores, 5 to 100 — not the size of one.
const HOBBY_STORAGE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
const SUPABASE_STORAGE_FREE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
const SUPABASE_DB_FREE_LIMIT_BYTES = 500 * 1024 * 1024;

const LIST_PAGE_SIZE = 1000;
const MAX_PREFIX_DEPTH = 4;

type StoredFile = { path: string; size: number; sizeKnown: boolean };
type BucketUsage = { bucket: string; files: StoredFile[]; error: string | null };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unitIndex]}`;
}

function totalBytes(files: StoredFile[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

async function fetchAllBlobs() {
  const blobs: { pathname: string; size: number }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await list({ cursor, limit: 1000 });
    blobs.push(...result.blobs.map((b) => ({ pathname: b.pathname, size: b.size })));
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  return blobs;
}

// Two things make this more than a single list() call. Buckets keyed
// <matchId>/<replayId> return per-match pseudo-folders at the root (id: null,
// since a prefix isn't a real storage object), so each needs its own listing;
// and list() pages at 100 by default, which would silently stop counting at
// the 101st match and report a plausible-looking total.
async function listPrefix(bucket: string, prefix: string, depth: number): Promise<StoredFile[]> {
  if (depth > MAX_PREFIX_DEPTH) return [];

  const files: StoredFile[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) throw new Error(error.message);

    const entries = data ?? [];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        files.push(...(await listPrefix(bucket, path, depth + 1)));
        continue;
      }
      const rawSize = entry.metadata?.size;
      const sizeKnown = typeof rawSize === "number";
      files.push({ path, size: sizeKnown ? rawSize : 0, sizeKnown });
    }

    if (entries.length < LIST_PAGE_SIZE) break;
  }
  return files;
}

// Every bucket counts against one account-wide cap, so the panel enumerates
// them rather than naming any — a bucket added later is counted without a code
// change. A bucket that fails to list is reported on its own row instead of
// throwing, because a blank usage bar reads as "plenty of room".
async function fetchSupabaseBuckets(): Promise<BucketUsage[]> {
  const { data, error } = await supabaseAdmin.storage.listBuckets();
  if (error) throw new Error(error.message);

  const names = (data ?? []).map((b) => b.name).sort();
  return Promise.all(
    names.map(async (bucket) => {
      try {
        return { bucket, files: await listPrefix(bucket, "", 0), error: null };
      } catch (e) {
        return {
          bucket,
          files: [],
          error: e instanceof Error ? e.message : "Failed to list this bucket.",
        };
      }
    }),
  );
}

async function fetchDatabaseSizeBytes(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_database_size_bytes");
  if (error) throw new Error(error.message);
  return Number(data);
}

// This panel is an async server component handed to AdminSubSection as
// children, and AdminSubSection is a client component - so the server has
// already run all three measurements by the time the client decides the
// Storage tab isn't open and returns null. Every /dashboard/admin render paid
// for them, including the ~30 router.refresh() calls scattered through the
// admin actions, which is how blob list() (a billed advanced operation) went
// 128% over the 2,000/month free-tier cap in a single heavy admin session.
// list() is capped at ~24 calls/day by this window; the Supabase bucket walk
// (one storage list per match pseudo-folder) collapses with it. Storage totals
// move on the order of days, so an hour of staleness costs nothing - the
// measurement time is shown so nobody reads a cached number as live.
const MEASUREMENT_TTL_SECONDS = 3600;

type Measured<T> = { value: T; error: string | null; measuredAt: string };

// The failure is cached alongside the success on purpose. unstable_cache stores
// nothing when the fetcher throws, so catching outside it meant a failing
// measurement retried on every single admin render - the exact uncapped call
// rate the window above exists to prevent, and list() is billed whether or not
// it succeeds. Catching inside puts a broken backend on the same hourly budget
// as a working one. The cost is that fixing a backend takes up to an hour to
// show here, which is why the panel timestamps the error too rather than
// letting a stale failure read as a live one.
function measured<T>(key: string, fetcher: () => Promise<T>, empty: T, fallbackMessage: string) {
  return unstable_cache(
    async (): Promise<Measured<T>> => {
      const measuredAt = new Date().toISOString();
      try {
        return { value: await fetcher(), error: null, measuredAt };
      } catch (e) {
        return { value: empty, error: e instanceof Error ? e.message : fallbackMessage, measuredAt };
      }
    },
    ["admin-storage", key],
    { revalidate: MEASUREMENT_TTL_SECONDS, tags: ["admin-storage-usage"] },
  );
}

const measuredBlobs = measured("blobs", fetchAllBlobs, [], "Failed to load Blob storage usage.");
const measuredBuckets = measured("buckets", fetchSupabaseBuckets, [], "Failed to load Supabase storage usage.");
const measuredDatabaseSize = measured(
  "database-size",
  fetchDatabaseSizeBytes,
  0,
  "Failed to load database size. Has scripts/add-database-size-rpc-migration.sql been run?",
);

function MeasuredAt({ iso, failed = false }: { iso: string | null; failed?: boolean }) {
  if (!iso) return null;
  return (
    <p className="text-xs text-zinc-600 mt-2">
      {failed ? "Attempted" : "Measured"} <LocalTime iso={iso} className="text-zinc-500" />{" "}
      · {failed ? "retries hourly" : "refreshes hourly"}
    </p>
  );
}

function UsageStats({
  usedLabel,
  used,
  cap,
  capLabel,
  extraStat,
}: {
  usedLabel: string;
  used: number;
  cap: number;
  capLabel: string;
  extraStat?: { label: string; value: string | number };
}) {
  const usagePct = Math.min(100, (used / cap) * 100);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{usedLabel}</p>
          <p className="text-2xl font-bold text-white mt-1">{formatBytes(used)}</p>
          <p className="text-xs text-zinc-500 mt-1">of {capLabel}</p>
        </div>
        {extraStat && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{extraStat.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{extraStat.value}</p>
          </div>
        )}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Used</p>
          <p className="text-2xl font-bold text-white mt-1">{usagePct.toFixed(1)}%</p>
        </div>
      </div>

      <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${usagePct > 90 ? "bg-red-500" : usagePct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${usagePct}%` }}
        />
      </div>
    </div>
  );
}

function BucketBreakdown({ buckets }: { buckets: BucketUsage[] }) {
  const rows = [...buckets].sort((a, b) => totalBytes(b.files) - totalBytes(a.files));
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">By Bucket</p>
      <div className="space-y-1.5">
        {rows.map((b) => (
          <div
            key={b.bucket}
            className="flex items-center gap-3 text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2"
          >
            <span className="flex-1 text-zinc-300 truncate font-mono text-xs">{b.bucket}</span>
            {b.error ? (
              <span className="shrink-0 text-xs text-red-400">{b.error}</span>
            ) : (
              <>
                <span className="shrink-0 text-xs text-zinc-500">{b.files.length} files</span>
                <span className="shrink-0 text-zinc-400">{formatBytes(totalBytes(b.files))}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LargestFiles({ files }: { files: { path: string; size: number }[] }) {
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  if (largest.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Largest Files</p>
      <div className="space-y-1.5">
        {largest.map((f) => (
          <div key={f.path} className="flex items-center gap-3 text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
            <span className="flex-1 text-zinc-300 truncate font-mono text-xs">{f.path}</span>
            <span className="text-zinc-500 shrink-0">{formatBytes(f.size)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export async function StorageUsageSection() {
  const { value: blobs, error: blobError, measuredAt: blobMeasuredAt } = await measuredBlobs();
  const { value: buckets, error: bucketError, measuredAt: bucketMeasuredAt } = await measuredBuckets();
  const { value: dbSizeBytes, error: dbError, measuredAt: dbMeasuredAt } = await measuredDatabaseSize();

  const blobTotalBytes = blobs.reduce((sum, b) => sum + b.size, 0);

  const bucketFiles = buckets.flatMap((b) =>
    b.files.map((f) => ({ ...f, path: `${b.bucket}/${f.path}` })),
  );
  const bucketTotalBytes = totalBytes(bucketFiles);
  const unsizedCount = bucketFiles.filter((f) => !f.sizeKnown).length;
  const failedBuckets = buckets.filter((b) => b.error);

  return (
    <AdminSubSection
      sectionId="data"
      tabId="storage"
      title="Storage & Limits"
      description="Live usage across every storage backend the app relies on, measured against each provider's free-tier cap."
    >
      <div className="space-y-8">
        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Vercel Blob (sponsor logo/video uploads)</h3>
          {blobError ? (
            <div>
              <p className="text-sm text-red-400">{blobError}</p>
              <MeasuredAt iso={blobMeasuredAt} failed />
            </div>
          ) : (
            <div className="space-y-4">
              <UsageStats
                usedLabel="Storage Used"
                used={blobTotalBytes}
                cap={HOBBY_STORAGE_LIMIT_BYTES}
                capLabel="1 GB cap (Hobby free tier)"
                extraStat={{ label: "Files", value: blobs.length }}
              />
              <LargestFiles files={blobs.map((b) => ({ path: b.pathname, size: b.size }))} />
              <MeasuredAt iso={blobMeasuredAt} />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Supabase Storage (all buckets)</h3>
          {bucketError ? (
            <div>
              <p className="text-sm text-red-400">{bucketError}</p>
              <MeasuredAt iso={bucketMeasuredAt} failed />
            </div>
          ) : (
            <div className="space-y-4">
              <UsageStats
                usedLabel="Storage Used"
                used={bucketTotalBytes}
                cap={SUPABASE_STORAGE_FREE_LIMIT_BYTES}
                capLabel="1 GB cap (free tier, shared by every bucket)"
                extraStat={{ label: "Files", value: bucketFiles.length }}
              />
              {failedBuckets.length > 0 && (
                <p className="text-sm text-red-400">
                  {failedBuckets.length === 1 ? "1 bucket" : `${failedBuckets.length} buckets`} could not be
                  listed, so the total above is lower than actual usage.
                </p>
              )}
              {unsizedCount > 0 && (
                <p className="text-sm text-amber-400">
                  {unsizedCount} file{unsizedCount === 1 ? "" : "s"} reported no size and counted as 0 B.
                </p>
              )}
              <BucketBreakdown buckets={buckets} />
              <LargestFiles files={bucketFiles} />
              <MeasuredAt iso={bucketMeasuredAt} />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Supabase Database</h3>
          {dbError ? (
            <div>
              <p className="text-sm text-red-400">{dbError}</p>
              <MeasuredAt iso={dbMeasuredAt} failed />
            </div>
          ) : (
            <div>
              <UsageStats
                usedLabel="Database Size"
                used={dbSizeBytes}
                cap={SUPABASE_DB_FREE_LIMIT_BYTES}
                capLabel="500 MB cap (free tier)"
              />
              <MeasuredAt iso={dbMeasuredAt} />
            </div>
          )}
        </div>
      </div>
    </AdminSubSection>
  );
}
