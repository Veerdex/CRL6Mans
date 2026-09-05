import { del } from "@vercel/blob";

const OWN_BLOB = /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//;

// Media fields also accept a hand-typed link — a YouTube video, a sponsor's own
// site — and those are not ours to delete. Only files we uploaded qualify.
export function isOwnBlobUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && OWN_BLOB.test(url);
}

export async function deleteBlobs(urls: (string | null | undefined)[]): Promise<void> {
  const targets = [...new Set(urls.filter(isOwnBlobUrl))];
  if (targets.length === 0) return;
  try {
    await del(targets);
  } catch {
    // Network boundary: the row is already written, so a failed delete just
    // leaves the orphan we used to leak unconditionally. Never fail the save.
  }
}

// Every URL the row carried that it no longer carries — a replacement, a
// cleared field, or a removed content item all reduce to the same thing.
export async function deleteDroppedBlobs(
  before: (string | null | undefined)[],
  after: (string | null | undefined)[]
): Promise<void> {
  const kept = new Set(after.filter(isOwnBlobUrl));
  await deleteBlobs(before.filter((url) => isOwnBlobUrl(url) && !kept.has(url)));
}
