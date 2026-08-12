import { list } from "@vercel/blob";
import { supabaseAdmin } from "@/app/lib/supabase";
import { AdminSubSection } from "./admin-sub-section";

const HOBBY_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const SUPABASE_STORAGE_FREE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
const SUPABASE_DB_FREE_LIMIT_BYTES = 500 * 1024 * 1024;
const VERIFICATION_REPLAYS_BUCKET = "platform-verification-replays";

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

async function fetchAllBlobs() {
  const blobs: { pathname: string; size: number }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await list({ cursor, limit: 1000 });
    blobs.push(...result.blobs);
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  return blobs;
}

// The bucket is two levels deep — root-level list() mixes files with
// per-player pseudo-folders (folders come back with id: null since they
// aren't real storage objects), so each folder needs its own list() call.
// Mirrors the traversal in cleanupOrphanedVerificationReplays.
async function fetchSupabaseBucketFiles() {
  const files: { path: string; size: number }[] = [];
  const { data: entries } = await supabaseAdmin.storage.from(VERIFICATION_REPLAYS_BUCKET).list();
  for (const entry of entries ?? []) {
    if (entry.id !== null) {
      files.push({ path: entry.name, size: entry.metadata?.size ?? 0 });
      continue;
    }
    const { data: inner } = await supabaseAdmin.storage.from(VERIFICATION_REPLAYS_BUCKET).list(entry.name);
    for (const file of inner ?? []) {
      files.push({ path: `${entry.name}/${file.name}`, size: file.metadata?.size ?? 0 });
    }
  }
  return files;
}

async function fetchDatabaseSizeBytes(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_database_size_bytes");
  if (error) throw new Error(error.message);
  return Number(data);
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
  let blobs: { pathname: string; size: number }[] = [];
  let blobError: string | null = null;
  try {
    blobs = await fetchAllBlobs();
  } catch (e) {
    blobError = e instanceof Error ? e.message : "Failed to load Blob storage usage.";
  }

  let bucketFiles: { path: string; size: number }[] = [];
  let bucketError: string | null = null;
  try {
    bucketFiles = await fetchSupabaseBucketFiles();
  } catch (e) {
    bucketError = e instanceof Error ? e.message : "Failed to load Supabase storage usage.";
  }

  let dbSizeBytes = 0;
  let dbError: string | null = null;
  try {
    dbSizeBytes = await fetchDatabaseSizeBytes();
  } catch (e) {
    dbError = e instanceof Error
      ? e.message
      : "Failed to load database size. Has scripts/add-database-size-rpc-migration.sql been run?";
  }

  const blobTotalBytes = blobs.reduce((sum, b) => sum + b.size, 0);
  const bucketTotalBytes = bucketFiles.reduce((sum, f) => sum + f.size, 0);

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
            <p className="text-sm text-red-400">{blobError}</p>
          ) : (
            <div className="space-y-4">
              <UsageStats
                usedLabel="Storage Used"
                used={blobTotalBytes}
                cap={HOBBY_STORAGE_LIMIT_BYTES}
                capLabel="5 GB cap (Hobby free tier)"
                extraStat={{ label: "Files", value: blobs.length }}
              />
              <LargestFiles files={blobs.map((b) => ({ path: b.pathname, size: b.size }))} />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Supabase Storage (replay verification uploads)</h3>
          {bucketError ? (
            <p className="text-sm text-red-400">{bucketError}</p>
          ) : (
            <div className="space-y-4">
              <UsageStats
                usedLabel="Storage Used"
                used={bucketTotalBytes}
                cap={SUPABASE_STORAGE_FREE_LIMIT_BYTES}
                capLabel="1 GB cap (free tier)"
                extraStat={{ label: "Files", value: bucketFiles.length }}
              />
              <LargestFiles files={bucketFiles} />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Supabase Database</h3>
          {dbError ? (
            <p className="text-sm text-red-400">{dbError}</p>
          ) : (
            <UsageStats
              usedLabel="Database Size"
              used={dbSizeBytes}
              cap={SUPABASE_DB_FREE_LIMIT_BYTES}
              capLabel="500 MB cap (free tier)"
            />
          )}
        </div>
      </div>
    </AdminSubSection>
  );
}
