import { list } from "@vercel/blob";
import { AdminSubSection } from "./admin-sub-section";

const HOBBY_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

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

export async function StorageUsageSection() {
  let blobs: { pathname: string; size: number }[] = [];
  let error: string | null = null;
  try {
    blobs = await fetchAllBlobs();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load Blob storage usage.";
  }

  const totalBytes = blobs.reduce((sum, b) => sum + b.size, 0);
  const usagePct = Math.min(100, (totalBytes / HOBBY_STORAGE_LIMIT_BYTES) * 100);
  const largest = [...blobs].sort((a, b) => b.size - a.size).slice(0, 5);

  return (
    <AdminSubSection
      sectionId="data"
      tabId="storage"
      title="Storage & Limits"
      description="Live usage of the Vercel Blob store backing sponsor logo/video uploads, measured against the free Hobby-plan cap. Once storage hits the cap, new uploads fail until the next monthly reset."
    >
      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Storage Used</p>
              <p className="text-2xl font-bold text-white mt-1">{formatBytes(totalBytes)}</p>
              <p className="text-xs text-zinc-500 mt-1">of 5 GB free (Hobby)</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Files</p>
              <p className="text-2xl font-bold text-white mt-1">{blobs.length}</p>
            </div>
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

          {largest.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Largest Files</p>
              <div className="space-y-1.5">
                {largest.map((b) => (
                  <div key={b.pathname} className="flex items-center gap-3 text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                    <span className="flex-1 text-zinc-300 truncate font-mono text-xs">{b.pathname}</span>
                    <span className="text-zinc-500 shrink-0">{formatBytes(b.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminSubSection>
  );
}
